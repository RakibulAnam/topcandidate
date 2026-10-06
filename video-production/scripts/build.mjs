#!/usr/bin/env node
// npm run build -- <project> [--no-music] [--no-captions] [--no-sfx] [--no-overlays]
//
// Compiles projects/<p>/edit.json (the editorial decisions) into a self-contained HyperFrames
// project at projects/<p>/composition/ (index.html + media/ + assets/). Deterministic and
// idempotent: re-run after every edit.json change. Never touches input/.
import { existsSync, linkSync, copyFileSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { ROOT, SHARED, VIDEO_EXT, AUDIO_EXT, projectDir, readJSON, writeJSON, ensureDir, parseArgs, die, log, round, run, ffprobe, escapeHTML, richText } from "./lib/util.mjs";
import { BRAND, FORMAT, SAFE } from "./lib/config.mjs";
import { buildCaptions, renderCaptions, CAPTION_DEFAULTS } from "./lib/captions.mjs";
import { components } from "../shared/components/index.mjs";

const args = parseArgs(process.argv.slice(2));
const P = projectDir(args._[0]);
const editPath = join(P, "edit.json");
if (!existsSync(editPath)) die(`No edit.json in ${P}. Ingest first, then write the edit plan (see guides/EDIT_SPEC.md).`);
const E = readJSON(editPath);
const C = ensureDir(join(P, "composition"));
const MEDIA = ensureDir(join(C, "media"));
const warnings = [];
const warn = (m) => (warnings.push(m), console.warn(`  ! ${m}`));

const fmt = { ...FORMAT, ...(E.format || {}) };
const source = E.source || "working/source.mp4";
if (!existsSync(join(P, source))) die(`Source not found: ${source} — run npm run ingest -- ${basename(P)}`);
const srcDur = Number(ffprobe(join(P, source)).format.duration);

// ---------------------------------------------------------------- media linking
function link(abs, rel) {
  const dest = join(C, rel);
  ensureDir(join(dest, ".."));
  if (existsSync(dest)) rmSync(dest);
  try { linkSync(abs, dest); } catch { copyFileSync(abs, dest); }
  return rel;
}
// Resolve a user/Claude-supplied asset reference to an absolute file.
function findAsset(ref) {
  if (!ref) return null;
  const cands = [join(P, ref), join(P, "assets", ref), join(P, "input", ref), join(SHARED, ref), join(SHARED, "ui", ref), join(SHARED, "broll", ref), join(SHARED, "music", ref), join(SHARED, "logos", ref), join(SHARED, "stickers", ref), join(ROOT, ref), resolve(ref)];
  return cands.find((p) => existsSync(p) && statSync(p).isFile()) || null;
}
function useAsset(ref, sub = "media") {
  const abs = findAsset(ref);
  if (!abs) return (warn(`asset not found: ${ref}`), null);
  return link(abs, `${sub}/${basename(abs)}`);
}
const durCache = {};
const mediaDur = (abs) => (durCache[abs] ??= Number(ffprobe(abs).format.duration));

// ---------------------------------------------------------------- segments → timeline map
let segs = (Array.isArray(E.segments) ? E.segments : []).map((s, k) => ({ id: s.id || `s${k + 1}`, ...s, in: Number(s.in), out: Math.min(Number(s.out), srcDur) })).filter((s) => s.out - s.in > 0.04);
if (!segs.length) segs = [{ id: "s1", in: 0, out: srcDur }];
let tcur = 0;
for (const s of segs) (s.start = round(tcur, 3), (s.dur = round(s.out - s.in, 3)), (tcur += s.dur));
const editDur = round(tcur, 3);

const srcToTl = (t) => {
  const s = segs.find((x) => t >= x.in - 1e-3 && t < x.out + 1e-3);
  return s ? s.start + Math.min(Math.max(t - s.in, 0), s.dur) : null;
};

// Transcript (source time) → timeline words.
const transcript = readJSON(join(P, "captions/transcript.json"), []);
const tlWords = [];
for (const w of transcript) {
  const mid = (w.start + w.end) / 2;
  const s = segs.find((x) => mid >= x.in && mid < x.out);
  if (!s) continue;
  tlWords.push({ text: w.text, seg: s.id, src: w.start, start: round(s.start + Math.max(w.start, s.in) - s.in), end: round(s.start + Math.min(w.end, s.out) - s.in) });
}

// Outro (e.g. CTA card) extends the timeline after the last segment (optionally overlapping it).
const outro = E.outro && E.outro.type ? { ...E.outro, dur: Number(E.outro.dur ?? 2.8), overlap: Number(E.outro.overlap ?? 0) } : null;
const outroStart = outro ? round(editDur - outro.overlap, 3) : editDur;
const total = round(outro ? outroStart + outro.dur : editDur, 3);

// Time references used anywhere in edit.json:
//   3.2 | {t:3.2} timeline · {src:12.4} source · {word:"same CV", occurrence:1, edge:"start"|"end"}
//   {segment:"s3"} · {outro:0} · any of these + {offset:-0.1}
const normTok = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
function resolveTime(ref) {
  if (ref === undefined || ref === null) return null;
  if (typeof ref === "number") return ref;
  const off = Number(ref.offset || 0);
  let t = null;
  if (ref.t !== undefined) t = Number(ref.t);
  else if (ref.src !== undefined) {
    t = srcToTl(Number(ref.src));
    if (t === null) warn(`source time ${ref.src}s falls in a cut — element skipped`);
  } else if (ref.segment) {
    const s = segs.find((x) => x.id === ref.segment);
    t = s ? s.start : (warn(`unknown segment ${ref.segment}`), null);
  } else if (ref.outro !== undefined) t = outroStart + Number(ref.outro);
  else if (ref.word) {
    const toks = String(ref.word).split(/\s+/).map(normTok).filter(Boolean);
    let seen = 0;
    for (let i = 0; i + toks.length <= tlWords.length; i++) {
      if (toks.every((x, k) => normTok(tlWords[i + k].text) === x) && ++seen === (ref.occurrence || 1)) {
        t = ref.edge === "end" ? tlWords[i + toks.length - 1].end : tlWords[i].start;
        break;
      }
    }
    if (t === null) warn(`phrase not found in kept transcript: "${ref.word}"`);
  }
  return t === null ? null : round(Math.max(0, t + off), 3);
}
function resolveDur(ov, t0) {
  if (ov.until !== undefined) {
    const t1 = resolveTime(ov.until);
    if (t1 !== null && t1 > t0) return round(t1 - t0, 3);
  }
  return Number(ov.dur ?? 2.5);
}

// ---------------------------------------------------------------- video layer
const vSrc = link(join(P, source), "media/source.mp4");
const rf = { focusX: 0.5, focusY: 0.4, zoom: 1, ...(E.reframe || {}) };
const cam = { autoPunch: true, punchScale: 1.08, ...(E.camera || {}) };
const objPos = `${(rf.focusX * 100).toFixed(1)}% ${(rf.focusY * 100).toFixed(1)}%`;
const origin = `${(rf.focusX * 100).toFixed(1)}% ${(rf.focusY * 80).toFixed(1)}%`;
let videoHTML = "", js = [];
// filter:blur forces HyperFrames' slower screenshot capture, so only baseline it when used.
const usesBlur = (E.segments || []).some((s) => s.transition === "whip") || (E.cameraMoves || []).some((m) => m.type === "blur");
js.push(`tl.set("#cam", { scale: ${rf.zoom}, transformOrigin: "${origin}" }, 0);`, `tl.set("#camfx", { scale: 1, x: 0${usesBlur ? ', filter: "blur(0px)"' : ""} }, 0);`);
let punchToggle = false;
segs.forEach((s, k) => {
  videoHTML += `      <video id="seg-${s.id}" class="seg" src="${vSrc}" data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.in}" data-track-index="0" data-has-audio="true" ${s.volume !== undefined ? `data-volume="${s.volume}"` : ""} playsinline style="object-position:${s.focus ? `${s.focus[0] * 100}% ${s.focus[1] * 100}%` : objPos}"></video>\n`;
  // Jump-cut masking: alternate a subtle punch-in on consecutive takes of the same shot.
  let z = s.zoom;
  if (z === undefined && cam.autoPunch && k > 0 && s.in - segs[k - 1].out < 4 && s.in > segs[k - 1].in) z = (punchToggle = !punchToggle) ? rf.zoom * cam.punchScale : rf.zoom;
  else if (z === undefined) punchToggle = false;
  if (k > 0 || z !== undefined) js.push(`tl.set("#cam", { scale: ${z ?? rf.zoom} }, ${s.start});`);
  if (s.transition === "flash") js.push(`tl.fromTo("#flash", { opacity: 0.85 }, { opacity: 0, duration: 0.2, ease: "power2.out", immediateRender: false }, ${s.start});`);
  if (s.transition === "whip") js.push(`tl.fromTo("#camfx", { x: -90, filter: "blur(16px)" }, { x: 0, filter: "blur(0px)", duration: 0.24, ease: "power3.out", immediateRender: false }, ${s.start});`);
});

// Camera moves: { at, dur, type: punch|push|blur|shake, scale }
for (const m of E.cameraMoves || []) {
  const t = resolveTime(m.at);
  if (t === null) continue;
  const d = Number(m.dur ?? 1.2), sc = Number(m.scale ?? (m.type === "push" ? 1.12 : 1.18));
  if (m.type === "punch") js.push(`tl.fromTo("#camfx", { scale: 1 }, { scale: ${sc}, duration: 0.12, ease: "power3.out", immediateRender: false }, ${t});`, `tl.fromTo("#camfx", { scale: ${sc} }, { scale: 1, duration: 0.25, ease: "power2.inOut", immediateRender: false }, ${round(t + d - 0.25)});`);
  if (m.type === "push") js.push(`tl.fromTo("#camfx", { scale: 1 }, { scale: ${sc}, duration: ${d}, ease: "none", immediateRender: false }, ${t});`, `tl.set("#camfx", { scale: 1 }, ${round(t + d)});`);
  if (m.type === "blur") js.push(`tl.fromTo("#camfx", { filter: "blur(0px)" }, { filter: "blur(${m.amount ?? 18}px)", duration: 0.25, ease: "power2.out", immediateRender: false }, ${t});`, `tl.fromTo("#camfx", { filter: "blur(${m.amount ?? 18}px)" }, { filter: "blur(0px)", duration: 0.25, ease: "power2.in", immediateRender: false }, ${round(t + d - 0.25)});`);
  if (m.type === "shake") [0, 1, 2, 3, 4, 5].forEach((i) => js.push(`tl.set("#camfx", { x: ${[14, -12, 9, -7, 4, 0][i]}, y: ${[-8, 10, -6, 5, -2, 0][i]} }, ${round(t + i * 0.04)});`));
}

// ---------------------------------------------------------------- overlays
const ctxBase = { B: BRAND, esc: escapeHTML, rich: richText };
let ovHTML = "", sfx = [];
if (args.overlays !== false) {
  (E.overlays || []).forEach((ov, k) => {
    if (ov.disabled) return;
    const t0 = resolveTime(ov.at);
    if (t0 === null) return;
    let dur = resolveDur(ov, t0);
    if (t0 + dur > total) dur = round(total - t0, 3);
    const id = ov.id || `ov-${k}`;
    const props = { ...(ov.props || {}) };
    const isVideo = ov.type === "broll" && VIDEO_EXT.has(extname(props.src || "").toLowerCase());
    if (props.src) props.src = useAsset(props.src) || props.src;
    if (isVideo) {
      // Timed <video> must not sit inside another timed element → untimed wrapper.
      const zone = props.zone || "full";
      const box = zone === "full" ? "left:0;top:0;width:1080px;height:1920px" : zone === "upper" ? "left:0;top:0;width:1080px;height:1000px" : "left:520px;top:260px;width:460px;height:620px";
      ovHTML += `    <div class="broll-wrap ${zone === "pip" ? "pip" : ""}" id="${id}-w" style="${box};z-index:${ov.z ?? 30};opacity:0"><video id="${id}-v" src="${props.src}" data-start="${t0}" data-duration="${dur}" data-media-start="${props.mediaStart ?? 0}" data-track-index="${30 + k}" ${props.volume ? `data-has-audio="true" data-volume="${props.volume}"` : "muted"} playsinline></video></div>\n`;
      js.push(`tl.fromTo("#${id}-w", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, ${t0});`, `tl.to("#${id}-w", { opacity: 0, duration: 0.12, ease: "none" }, ${round(t0 + dur - 0.12)});`);
      if (props.kenburns) js.push(`tl.fromTo("#${id}-v", { scale: 1.02 }, { scale: 1.1, duration: ${dur}, ease: "none" }, ${t0});`);
    } else if (ov.type === "html") {
      // Escape hatch: hand-written fragment. props.html (or props.file under composition/custom/), props.js uses T0/DUR.
      const frag = props.file ? readFileSync(join(P, props.file), "utf8") : props.html || "";
      ovHTML += `    <div id="${id}" class="clip ov" data-start="${t0}" data-duration="${dur}" data-track-index="${10 + k}" style="z-index:${ov.z ?? 30}"><div class="ov-in">${frag}</div></div>\n`;
      if (props.js) js.push(`((T0, DUR) => { ${props.js} })(${t0}, ${dur});`);
    } else {
      const comp = components[ov.type];
      if (!comp) return warn(`unknown overlay type "${ov.type}" — see guides/MOTION.md`);
      const out = comp(props, { ...ctxBase, id, t0, dur, sel: `#${id}` });
      ovHTML += `    <div id="${id}" class="clip ov" data-start="${t0}" data-duration="${dur}" data-track-index="${10 + k}" style="z-index:${ov.z ?? out.z ?? 30}"><div class="ov-in">${out.html}</div></div>\n`;
      js.push(out.js);
      if (ov.sfx) sfx.push({ name: ov.sfx === true ? out.sfx : typeof ov.sfx === "string" ? ov.sfx : ov.sfx.name, at: t0 + (ov.sfx.offset || 0), volume: ov.sfx.volume });
    }
  });
}

// Outro card.
if (outro) {
  const comp = components[outro.type];
  if (!comp) warn(`unknown outro type ${outro.type}`);
  else {
    const out = comp(outro.props || {}, { ...ctxBase, id: "outro", t0: outroStart, dur: outro.dur, sel: "#outro" });
    ovHTML += `    <div id="outro" class="clip ov" data-layout-allow-caption-zone data-start="${outroStart}" data-duration="${outro.dur}" data-track-index="9" style="z-index:${out.z ?? 60}"><div class="ov-in">${out.html}</div></div>\n`;
    js.push(out.js);
    if (outro.sfx !== false) sfx.push({ name: typeof outro.sfx === "string" ? outro.sfx : out.sfx, at: outroStart, volume: 0.3 });
  }
}

// ---------------------------------------------------------------- captions
const capOpts = { ...CAPTION_DEFAULTS, ...(E.captions || {}) };
let capHTML = "", srt = "", chunks = [];
if (capOpts.enabled && args.captions !== false && tlWords.length) {
  chunks = buildCaptions(tlWords.filter((w) => w.start < outroStart + 0.05 || !outro), capOpts);
  const r = renderCaptions(chunks, capOpts, BRAND);
  capHTML = r.html;
  srt = r.srt;
  js.push(r.js);
  for (const ch of chunks) for (const w of ch.words) if (w.mark?.first && w.mark.sfx) sfx.push({ name: w.mark.sfx === true ? "pop" : w.mark.sfx, at: w.start, volume: 0.35 });
}
writeFileSync(join(P, "captions/captions.srt"), srt);

// ---------------------------------------------------------------- sound design
sfx.push(...(E.sfx || []).map((s) => ({ name: s.name, at: resolveTime(s.at), volume: s.volume })));
for (const s of segs) if (s.sfx) sfx.push({ name: s.sfx, at: s.start, volume: 0.4 });
let audioHTML = "";
if (args.sfx !== false) {
  sfx.filter((s) => s.name && s.at !== null && s.at !== undefined).forEach((s, k) => {
    const abs = findAsset(s.name.includes(".") ? s.name : `sound-effects/${s.name}.mp3`);
    if (!abs) return warn(`sfx not found: ${s.name}`);
    const rel = link(abs, `media/sfx/${basename(abs)}`);
    const d = Math.min(mediaDur(abs), Math.max(0.05, total - s.at));
    audioHTML += `    <audio id="sfx-${k}" src="${rel}" data-start="${round(s.at)}" data-duration="${round(d)}" data-volume="${s.volume ?? 0.4}" data-track-index="${50 + k}"></audio>\n`;
  });
}

// Music bed: pre-rendered (looped, trimmed, faded) with ffmpeg; ducked under speech via a volume lane.
const M = E.music;
if (M && M.file && args.music !== false) {
  const abs = findAsset(M.file);
  if (!abs) warn(`music not found: ${M.file} (put tracks in shared/music/ or the project's assets/)`);
  else {
    const mStart = resolveTime(M.start ?? 0) ?? 0, mEnd = M.end !== undefined ? resolveTime(M.end) ?? total : total;
    const len = round(mEnd - mStart), fi = M.fadeIn ?? 0.6, fo = M.fadeOut ?? 1.5;
    const bed = join(MEDIA, "music-bed.wav");
    run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-stream_loop", "-1", "-ss", String(M.offset ?? 0), "-i", abs, "-t", String(len), "-af", `afade=t=in:d=${fi},afade=t=out:st=${Math.max(0, len - fo)}:d=${fo}`, "-ar", "48000", "-ac", "2", bed]);
    const full = M.volume ?? 0.2, duck = M.duck ?? 0.06;
    // Speech blocks (timeline) merged across short gaps.
    const blocks = [];
    for (const w of tlWords) {
      const last = blocks.at(-1);
      if (last && w.start - last[1] < 0.8) last[1] = w.end;
      else blocks.push([w.start, w.end]);
    }
    const pts = [{ t: 0, v: blocks.length && blocks[0][0] - mStart < 0.3 ? duck : full }];
    for (const [a, b] of blocks) {
      const s = a - mStart, e = b - mStart;
      if (e < 0 || s > len) continue;
      pts.push({ t: round(Math.max(0, s - 0.25)), v: full }, { t: round(Math.max(0, s)), v: duck }, { t: round(e + 0.05), v: duck }, { t: round(e + 0.4), v: full });
    }
    const lane = { version: 1, lanes: [{ target: "volume", points: dedupe(pts).slice(0, 512) }] };
    audioHTML += `    <audio id="music" src="media/music-bed.wav" data-start="${mStart}" data-duration="${len}" data-volume="${full}" data-automation="${escapeHTML(JSON.stringify(lane))}" data-track-index="41"></audio>\n`;
  }
}
function dedupe(pts) {
  const out = [];
  for (const p of pts.sort((a, b) => a.t - b.t)) {
    if (out.length && Math.abs(out.at(-1).t - p.t) < 0.01) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- assets + HTML
const fontsDir = join(SHARED, "fonts");
if (!existsSync(fontsDir)) die("shared/fonts missing — run npm run setup");
const FAMILY = { "instrument-sans": "Instrument Sans", "source-serif-4": "Source Serif 4", "hind-siliguri": "Hind Siliguri", "tiro-bangla": "Tiro Bangla" };
const BENGALI_RANGE = "U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0, U+1CD2, U+1CD5-1CD6, U+1CD8, U+1CE1, U+1CEA, U+1CED, U+1CF2, U+1CF5-1CF7, U+200C-200D, U+20B9, U+25CC, U+A8F1";
let fontCSS = "";
for (const f of readdirSync(fontsDir).filter((x) => x.endsWith(".woff2")).sort()) {
  const m = f.match(/^(.*?)-(latin-ext|latin|bengali)-(\d+)-(normal|italic)\.woff2$/);
  if (!m) continue;
  const rel = link(join(fontsDir, f), `assets/fonts/${f}`);
  fontCSS += `@font-face { font-family: "${FAMILY[m[1]]}"; src: url("${rel}") format("woff2"); font-weight: ${m[3]}; font-style: ${m[4]}; font-display: block;${m[2] === "bengali" ? ` unicode-range: ${BENGALI_RANGE};` : ""} }\n`;
}
link(join(SHARED, "vendor/gsap.min.js"), "assets/gsap.min.js");
const css = readFileSync(join(SHARED, "brand/tokens.css"), "utf8") + "\n" + readFileSync(join(ROOT, "shared/components/components.css"), "utf8");

const html = `<!doctype html>
<!-- GENERATED by video-production/scripts/build.mjs from edit.json — edit edit.json, not this file. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${fmt.width}, height=${fmt.height}" />
    <title>${escapeHTML(E.title || basename(P))}</title>
    <script src="assets/gsap.min.js"></script>
    <style>
${fontCSS}
${css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${fmt.width}" data-height="${fmt.height}" data-duration="${total}">
    <div id="cam-wrap"><div id="cam"><div id="camfx">
${videoHTML}    </div></div></div>
${ovHTML}${capHTML}    <div id="flash"></div>
${audioHTML}    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${js.filter(Boolean).join("\n")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync(join(C, "index.html"), html);
writeJSON(join(C, "hyperframes.json"), { $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } });
if (!existsSync(join(C, "meta.json"))) writeJSON(join(C, "meta.json"), { id: basename(P), name: basename(P), createdAt: new Date().toISOString() });

// Reference map for revisions ("what's on screen at 0:12?").
writeJSON(join(P, "working/timeline.json"), {
  total, editDuration: editDur, outroStart: outro ? outroStart : null,
  segments: segs.map(({ id, in: i, out, start, dur }) => ({ id, in: i, out, start, dur })),
  captions: chunks.map((c) => ({ start: c.start, end: c.end, text: c.words.map((w) => w.text).join(" ") })),
  warnings,
});

const pj = readJSON(join(P, "project.json"), {});
if (["new", "ingested"].includes(pj.status)) writeJSON(join(P, "project.json"), { ...pj, status: "planned" });
console.log(`\n✓ Built composition: ${total}s (${segs.length} segments, ${chunks.length} caption chunks, ${(E.overlays || []).length} overlays, ${sfx.length} sfx${M?.file && args.music !== false ? ", music" : ""})${warnings.length ? `\n  ${warnings.length} warning(s) above` : ""}\n`);
