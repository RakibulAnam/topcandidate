#!/usr/bin/env node
// npm run ingest -- <project> [--lang auto|bn|en] [--denoise] [--fps 30|60] [--primary file] [--force] [--no-transcribe]
//
// RAW FOOTAGE IN → everything Claude needs to make editorial decisions:
//   working/probe.json        technical facts (duration, res, fps, VFR, HDR, rotation, audio)
//   working/source.mp4        normalized edit proxy (CFR, SDR, 1s GOP, loudness-normalized voice)
//   working/audio.wav         16 kHz mono for ASR / analysis
//   working/silences.json     ffmpeg silencedetect ranges
//   working/scenes.json       camera cuts already in the footage
//   working/contact-sheet.jpg timestamped thumbnails (framing / visual quality at a glance)
//   captions/transcript.raw.json   Whisper word timings (never edited)
//   captions/transcript.json       working copy Claude corrects (spelling/script), timings preserved
//   working/analysis.json + analysis.md   pauses, fillers, retakes, suggested keep-segments
// The files in input/ are never modified (they're made read-only here).
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { HF_BIN, VIDEO_EXT, IMAGE_EXT, AUDIO_EXT, projectDir, listFiles, ffprobe, fracToNum, run, readJSON, writeJSON, ensureDir, parseArgs, log, round, die } from "./lib/util.mjs";
import { WHISPER_MODEL, FILLERS, HARD_FILLERS, PAUSE, FORMAT } from "./lib/config.mjs";

const args = parseArgs(process.argv.slice(2));
const P = projectDir(args._[0]);
const W = ensureDir(join(P, "working"));
const fps = Number(args.fps || FORMAT.fps);

// ---------------------------------------------------------------- inputs
const vids = listFiles(join(P, "input"), VIDEO_EXT);
if (!vids.length) die(`No video in ${join(P, "input")}. Drop raw footage there (mp4/mov/m4v/mkv/webm).`);
const primary =
  args.primary || vids.find((f) => /^raw\./i.test(f)) || vids.slice().sort((a, b) => statSync(join(P, "input", b)).size - statSync(join(P, "input", a)).size)[0];
const brolls = vids.filter((f) => f !== primary);
for (const f of listFiles(join(P, "input"))) chmodSync(join(P, "input", f), 0o444); // immutable
const RAW = join(P, "input", primary);
log(`primary: input/${primary}${brolls.length ? `  ·  b-roll: ${brolls.join(", ")}` : ""}`);

// ---------------------------------------------------------------- probe
function summarize(file) {
  const pr = ffprobe(file);
  const v = pr.streams.find((s) => s.codec_type === "video");
  const a = pr.streams.find((s) => s.codec_type === "audio");
  const rot = Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  let [w, h] = [v.width, v.height];
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [w, h] = [h, w];
  const rFps = fracToNum(v.r_frame_rate), aFps = fracToNum(v.avg_frame_rate);
  return {
    file: basename(file),
    duration: round(Number(pr.format.duration), 3),
    width: w, height: h, rotation: rot,
    orientation: w === h ? "square" : h > w ? "portrait" : "landscape",
    fps: round(aFps || rFps, 3), vfr: Math.abs(rFps - aFps) > 0.5,
    codec: v.codec_name, pixFmt: v.pix_fmt, bitrate: Number(pr.format.bit_rate || 0),
    hdr: ["arib-std-b67", "smpte2084"].includes(v.color_transfer), colorTransfer: v.color_transfer || null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: Number(a.sample_rate) } : null,
  };
}
const probe = summarize(RAW);
writeJSON(join(W, "probe.json"), probe);
log(`${probe.duration}s · ${probe.width}×${probe.height} ${probe.orientation} · ${probe.fps}fps${probe.vfr ? " (VFR)" : ""}${probe.hdr ? " · HDR" : ""} · audio ${probe.audio ? probe.audio.codec : "NONE"}`);
if (!probe.audio) log("! No audio stream — transcript/captions/cut suggestions will be skipped.");

// ---------------------------------------------------------------- proxy
function proxy(src, dest, info, { voice }) {
  if (existsSync(dest) && !args.force && statSync(dest).mtimeMs > statSync(src).mtimeMs) return log(`proxy exists: ${basename(dest)} (use --force to rebuild)`);
  // Keep just enough pixels to *cover* a 1080×1920 canvas (landscape keeps full height for reframing).
  const s = Math.min(1, Math.max(FORMAT.width / info.width, FORMAT.height / info.height));
  const vf = [];
  if (info.hdr) vf.push("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv");
  vf.push(`fps=${fps}`, `scale=${2 * Math.round((info.width * s) / 2)}:${2 * Math.round((info.height * s) / 2)}:flags=lanczos`, "format=yuv420p");
  const af = ["highpass=f=70"];
  if (voice && args.denoise) af.push("afftdn=nf=-25");
  if (voice) af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  const a = info.audio ? ["-af", af.join(","), "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k"] : ["-an"];
  log(`building proxy ${basename(dest)} …`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", vf.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", String(fps), "-keyint_min", String(fps), "-sc_threshold", "0", ...a, "-movflags", "+faststart", dest]);
}
proxy(RAW, join(W, "source.mp4"), probe, { voice: true });
const broll = brolls.map((f) => {
  const info = summarize(join(P, "input", f));
  const out = join(ensureDir(join(W, "broll")), basename(f, extname(f)) + ".mp4");
  proxy(join(P, "input", f), out, info, { voice: false });
  return { ...info, proxy: `working/broll/${basename(out)}` };
});

// ---------------------------------------------------------------- audio analysis
let silences = [], loudness = {};
if (probe.audio) {
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", join(W, "source.mp4"), "-vn", "-ac", "1", "-ar", "16000", join(W, "audio.wav")]);
  const sd = run("ffmpeg", ["-hide_banner", "-i", join(W, "audio.wav"), "-af", "silencedetect=noise=-32dB:d=0.25", "-f", "null", "-"]).stderr;
  let cur = null;
  for (const line of sd.split("\n")) {
    const s = line.match(/silence_start: ([\d.]+)/), e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = Number(s[1]);
    if (e && cur !== null) (silences.push({ start: round(cur), end: round(Number(e[1])) }), (cur = null));
  }
  if (cur !== null) silences.push({ start: round(cur), end: probe.duration });
  writeJSON(join(W, "silences.json"), silences);
  // Loudness of the *raw* audio (what the mic actually captured).
  const ebAll = run("ffmpeg", ["-hide_banner", "-nostats", "-i", RAW, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr;
  const eb = ebAll.slice(ebAll.lastIndexOf("Summary:")); // per-frame lines come first
  const grab = (re) => Number((eb.match(re) || [])[1]);
  loudness = { integratedLUFS: grab(/I:\s+(-?[\d.]+) LUFS/), lra: grab(/LRA:\s+([\d.]+) LU/), truePeak: grab(/Peak:\s+(-?[\d.]+) dBFS/) };
  const vd = run("ffmpeg", ["-hide_banner", "-i", join(W, "audio.wav"), "-af", "volumedetect", "-f", "null", "-"]).stderr;
  loudness.meanVolume = Number((vd.match(/mean_volume: (-?[\d.]+)/) || [])[1]);
  // Noise floor ≈ level inside detected silences (longest few).
  const quiet = silences.filter((s) => s.end - s.start > 0.4).slice(0, 5);
  if (quiet.length) {
    const sel = quiet.map((s) => `between(t,${s.start},${s.end})`).join("+");
    const nf = run("ffmpeg", ["-hide_banner", "-i", join(W, "audio.wav"), "-af", `aselect='${sel}',volumedetect`, "-f", "null", "-"], { allowFail: true }).stderr;
    loudness.noiseFloor = Number((nf.match(/mean_volume: (-?[\d.]+)/) || [])[1]) || null;
  }
}

// ---------------------------------------------------------------- visual analysis
const scenes = [];
{
  const out = run("ffmpeg", ["-hide_banner", "-i", join(W, "source.mp4"), "-an", "-vf", "scale=270:-2,select='gt(scene,0.32)',showinfo", "-f", "null", "-"]).stderr;
  for (const m of out.matchAll(/pts_time:([\d.]+)/g)) scenes.push(round(Number(m[1]), 2));
  writeJSON(join(W, "scenes.json"), scenes);
}
function contactSheet(src, dest, duration) {
  const n = 24, step = Math.max(0.5, duration / n);
  const font = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
  const label = existsSync(font) ? `,drawtext=fontfile='${font}':text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6` : "";
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-an", "-vf", `fps=1/${step},scale=270:-2${label},tile=6x4:padding=6:color=0x0F1B2D`, "-frames:v", "1", "-q:v", "3", dest]);
}
contactSheet(join(W, "source.mp4"), join(W, "contact-sheet.jpg"), probe.duration);
for (const b of broll) contactSheet(join(P, b.proxy), join(W, "broll", basename(b.proxy, ".mp4") + "-sheet.jpg"), b.duration);

// ---------------------------------------------------------------- transcription
const capDir = ensureDir(join(P, "captions"));
let words = [];
if (probe.audio && args.transcribe !== false) {
  const rawT = join(capDir, "transcript.raw.json");
  if (!existsSync(rawT) || args.force || args.retranscribe) {
    transcribe(rawT);
  }
  words = JSON.parse(readFileSync(rawT, "utf8")).map((w) => ({ text: String(w.text).trim(), start: round(w.start), end: round(Math.min(w.end, probe.duration)) })).filter((w) => w.text);
  // Working copy: never clobber Claude's corrections unless asked.
  if (!existsSync(join(capDir, "transcript.json")) || args.force || args.retranscribe) writeJSON(join(capDir, "transcript.json"), words);
  else words = readJSON(join(capDir, "transcript.json"));
}

// Whisper with exact timing. whisper.cpp smears word timestamps across long silences (a word
// "starts" a second early) and its --vad mode returns VAD-compressed times. So: concatenate the
// detected speech regions with fixed 0.3 s gaps, transcribe once, map every word back to source
// time, and clamp it inside its region. -mc 0 stops repetition loops on retakes.
// Language: "en" yields romanized Banglish as spoken (default); "bn" yields Bangla script.
function transcribe(dest) {
  const GAP = 0.3, PAD = 0.12;
  const regions = [];
  let t = 0;
  for (const s of silences) {
    if (s.start > t) regions.push([Math.max(0, t - PAD), Math.min(probe.duration, s.start + PAD)]);
    t = s.end;
  }
  if (t < probe.duration) regions.push([Math.max(0, t - PAD), probe.duration]);
  const merged = [];
  for (const r of regions) r[1] - r[0] > 0.05 && (merged.length && r[0] <= merged.at(-1)[1] ? (merged.at(-1)[1] = Math.max(merged.at(-1)[1], r[1])) : merged.push([...r]));
  const tDir = ensureDir(join(W, "transcribe"));
  const comp = join(tDir, "speech.wav");
  const parts = merged.map(([a, b], i) => `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=${GAP}[p${i}]`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", join(W, "audio.wav"), "-filter_complex", `${parts.join(";")};${merged.map((_, i) => `[p${i}]`).join("")}concat=n=${merged.length}:v=0:a=1[out]`, "-map", "[out]", "-ar", "16000", "-ac", "1", comp]);
  const cstart = [];
  merged.reduce((acc, [a, b], i) => ((cstart[i] = acc), acc + (b - a) + GAP), 0);

  const model = String(args.model || WHISPER_MODEL);
  const modelPath = join(process.env.HOME, ".cache/hyperframes/whisper/models", `ggml-${model}.bin`);
  if (!existsSync(modelPath)) die(`Whisper model missing (${modelPath}) — run npm run setup`);
  const lang = String(args.lang || process.env.TC_LANG || "en");
  log(`transcribing (whisper ${model}, lang=${lang}, ${merged.length} speech regions) …`);
  run("whisper-cli", ["-m", modelPath, "-f", comp, "-l", lang, "-mc", "0", "-sns", "-ojf", "--dtw", model.replace(/-/g, "."), "-of", join(tDir, "whisper")], { timeout: 60 * 60 * 1000 });
  // HyperFrames' normalizer turns whisper.cpp token JSON into a flat word array.
  run(HF_BIN, ["transcribe", join(tDir, "whisper.json"), "-d", tDir, "--json"]);
  const cw = JSON.parse(readFileSync(join(tDir, "transcript.json"), "utf8"));
  // A time inside an inserted gap is ambiguous: a word *start* there belongs to the next region
  // (whisper starts words early), a word *end* there belongs to the current one.
  const back = (ct, isStart) => {
    let i = cstart.findLastIndex((c) => c <= ct + 1e-6);
    if (i < 0) i = 0;
    const [a, b] = merged[i];
    if (ct - cstart[i] > b - a) return isStart && merged[i + 1] ? { t: merged[i + 1][0], i: i + 1 } : { t: b, i };
    return { t: a + Math.max(ct - cstart[i], 0), i };
  };
  const out = cw.map((w) => {
    const s = back(w.start, true), e = back(Math.max(w.start, w.end - 0.01), false);
    const end = e.i === s.i ? e.t : merged[s.i][1];
    return { text: w.text, start: round(s.t), end: round(Math.max(end, s.t + 0.05)) };
  });
  // DTW occasionally overruns a word's end across the next words; never overlap the next word.
  for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 0.03, out[i + 1].start);
  writeJSON(dest, out);
}

// ---------------------------------------------------------------- editorial analysis
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
const fmt = (t) => t.toFixed(2).padStart(6, "0");

const pauses = [];
for (let i = 1; i < words.length; i++) {
  const gap = words[i].start - words[i - 1].end;
  if (gap >= PAUSE.tighten) pauses.push({ after: i - 1, start: words[i - 1].end, end: words[i].start, dur: round(gap, 2), long: gap >= PAUSE.long });
}
const leadIn = words.length ? round(words[0].start, 2) : 0;
const tail = words.length ? round(probe.duration - words.at(-1).end, 2) : 0;

const fillers = [];
words.forEach((w, i) => {
  const n = norm(w.text);
  if (FILLERS.includes(n)) fillers.push({ i, text: w.text, start: w.start, end: w.end, hard: HARD_FILLERS.has(n) });
});

// Retakes: a ≥3-word phrase said again shortly after → the earlier attempt is a likely false start.
const retakes = [];
for (let i = 0; i + 2 < words.length; i++) {
  const tri = [0, 1, 2].map((k) => norm(words[i + k].text)).join(" ");
  if (tri.replace(/ /g, "").length < 6) continue;
  for (let j = i + 3; j + 2 < words.length && j < i + 45; j++) {
    if (words[j].start - words[i].start > 25) break;
    if ([0, 1, 2].map((k) => norm(words[j + k].text)).join(" ") !== tri) continue;
    const span = words.slice(i, j);
    const hasBreak = span.some((w, k) => k > 0 && w.start - span[k - 1].end > 0.35) || words[j].start - words[j - 1].end > 0.35 || span.some((w) => HARD_FILLERS.has(norm(w.text)));
    const prev = retakes.at(-1);
    if (prev && i <= prev.toWord) break;
    retakes.push({ fromWord: i, toWord: j - 1, start: words[i].start, end: words[j].start, phrase: span.slice(0, 6).map((w) => w.text).join(" "), confidence: hasBreak ? "high" : "low" });
    break;
  }
}

// Suggested keep-segments: speech runs split at pauses ≥ PAUSE.tighten, minus hard fillers and
// high-confidence retakes; boundaries snapped into detected silence so word tails aren't clipped.
const drop = new Set();
for (const f of fillers) if (f.hard) drop.add(f.i);
for (const r of retakes) if (r.confidence === "high") for (let k = r.fromWord; k <= r.toWord; k++) drop.add(k);
const runs = [];
let curRun = null;
words.forEach((w, i) => {
  if (drop.has(i)) return void (curRun = null);
  const prev = curRun && words[curRun.last];
  if (curRun && w.start - prev.end < PAUSE.tighten && curRun.last === i - 1) curRun.last = i;
  else runs.push((curRun = { first: i, last: i }));
});
const snapEnd = (t) => {
  const s = silences.find((x) => x.start >= t - 0.25 && x.start <= t + 0.4);
  return s ? Math.min(s.start + 0.1, s.end) : t + PAUSE.padOut;
};
const snapStart = (t) => {
  const s = silences.find((x) => x.end >= t - 0.4 && x.end <= t + 0.25);
  return s ? Math.max(s.end - 0.08, s.start) : t - PAUSE.padIn;
};
const segments = runs.map((r, k) => {
  let inT = Math.max(0, snapStart(words[r.first].start));
  let outT = Math.min(probe.duration, snapEnd(words[r.last].end));
  if (k > 0) inT = Math.max(inT, words[runs[k - 1].last].end + 0.02);
  if (runs[k + 1]) outT = Math.min(outT, words[runs[k + 1].first].start - 0.02);
  return { id: `s${k + 1}`, in: round(inT, 2), out: round(outT, 2), text: words.slice(r.first, r.last + 1).map((w) => w.text).join(" ") };
});
const keptDur = round(segments.reduce((a, s) => a + s.out - s.in, 0), 2);
const speechDur = words.reduce((a, w) => a + (w.end - w.start), 0);

// Sentences for the readable transcript.
const sentences = [];
let sent = [];
words.forEach((w, i) => {
  sent.push(w);
  const gap = words[i + 1] ? words[i + 1].start - w.end : 99;
  if (/[.?!।]$/.test(w.text) || gap > 0.6) (sentences.push(sent), (sent = []));
});

const analysis = {
  primary, probe, loudness, scenes, leadIn, tail,
  stats: { words: words.length, wpm: words.length ? round(words.length / (speechDur / 60), 0) : 0, rawDuration: probe.duration, suggestedDuration: keptDur },
  pauses, fillers, retakes, suggestedSegments: segments, broll,
  assets: { images: listFiles(join(P, "assets"), IMAGE_EXT).concat(listFiles(join(P, "input"), IMAGE_EXT)), audio: listFiles(join(P, "assets"), AUDIO_EXT) },
};
writeJSON(join(W, "analysis.json"), analysis);

const md = [
  `# Analysis — input/${primary}`,
  "",
  `${probe.duration}s · ${probe.width}×${probe.height} ${probe.orientation} · ${probe.fps}fps${probe.vfr ? " VFR→CFR" : ""}${probe.hdr ? " · HDR→SDR tonemapped" : ""} · proxy ${fps}fps`,
  probe.audio ? `Audio (raw): ${loudness.integratedLUFS} LUFS integrated, true peak ${loudness.truePeak} dBFS, LRA ${loudness.lra}, noise floor ≈ ${loudness.noiseFloor ?? "?"} dB · proxy normalized to −16 LUFS` : "Audio: none",
  `Camera cuts in footage: ${scenes.length ? scenes.join(", ") : "none (single take)"}`,
  `Speech: ${words.length} words · ~${analysis.stats.wpm} wpm · lead-in ${leadIn}s · tail ${tail}s`,
  `Suggested tightened duration: **${keptDur}s** (from ${probe.duration}s)`,
  "",
  "Look at `working/contact-sheet.jpg` for framing (where is the face? headroom? lighting?).",
  "",
  "## Transcript (source seconds)",
  "",
  ...sentences.map((s, k) => {
    const next = sentences[k + 1];
    const gap = next ? next[0].start - s.at(-1).end : 0;
    return `[${fmt(s[0].start)}–${fmt(s.at(-1).end)}] ${s.map((w) => w.text).join(" ")}${gap >= PAUSE.long ? `\n            ⏸ ${gap.toFixed(1)}s` : ""}`;
  }),
  "",
  "## Candidates (editor decides)",
  "",
  `- Long pauses (≥${PAUSE.long}s): ${pauses.filter((p) => p.long).map((p) => `${fmt(p.start)} (${p.dur}s)`).join(", ") || "none"}`,
  `- Fillers: ${fillers.map((f) => `"${f.text}"@${f.start.toFixed(2)}${f.hard ? "" : "?"}`).join(", ") || "none"}  (? = soft filler, often meaningful in Banglish — keep unless clearly verbal tic)`,
  ...(retakes.length ? retakes.map((r) => `- Retake (${r.confidence}): ${fmt(r.start)}–${fmt(r.end)} "${r.phrase}…" repeated → keep the later take`) : ["- Retakes: none detected"]),
  "",
  "## Suggested keep-segments (source in → out)",
  "",
  ...segments.map((s) => `- ${s.id}  ${fmt(s.in)} → ${fmt(s.out)}  (${(s.out - s.in).toFixed(2)}s)  ${s.text}`),
  "",
  broll.length ? `## B-roll in input/\n\n${broll.map((b) => `- ${b.proxy} — ${b.duration}s ${b.orientation}`).join("\n")}` : "",
].join("\n");
writeFileSync(join(W, "analysis.md"), md + "\n");

const pj = readJSON(join(P, "project.json"), {});
writeJSON(join(P, "project.json"), { ...pj, status: pj.status === "new" ? "ingested" : pj.status, primary, ingestedAt: new Date().toISOString() });
console.log(`\n✓ Ingested. Read projects/${basename(P)}/working/analysis.md (+ contact-sheet.jpg), correct captions/transcript.json, then write edit.json.\n`);
