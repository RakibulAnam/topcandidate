// Caption engine: timeline-mapped words → short readable chunks with strategic emphasis.
// Bangla script, Banglish and English all flow through the same path; Bangla script
// switches font (Hind Siliguri) per chunk.
import { escapeHTML } from "./util.mjs";
import { HARD_FILLERS } from "./config.mjs";

const BN = /[ঀ-৿]/;
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
const BASE_SIZE = { punch: 78, clean: 64, minimal: 54, tiktok: 80 };

export const CAPTION_DEFAULTS = {
  enabled: true,
  style: "punch", // punch | clean | minimal | tiktok (dark plate + active-word pill that jumps word to word)
  y: 1180, // top of caption box (px). Face usually sits 400–1000; platform UI covers > 1520.
  size: 1, // multiplier
  maxWords: 4,
  maxChars: 20,
  case: "none", // none | upper | lower
  karaoke: false, // dim upcoming words in the chunk
  hideFillers: true,
  hide: [], // extra words to drop from captions (not from audio)
  breakOnCut: true,
  emphasisStyle: "box", // default style for emphasis entries given as plain strings
  emphasis: [], // "same CV" | { text, style: box|ink|accent|underline|strike|big, occurrence: 1|"all" }
};

function matchEmphasis(words, list, defStyle) {
  const marks = new Array(words.length).fill(null); // { group, style }
  let g = 0;
  for (const raw of list) {
    const e = typeof raw === "string" ? { text: raw } : raw;
    const toks = e.text.split(/\s+/).map(norm).filter(Boolean);
    let seen = 0;
    for (let i = 0; i + toks.length <= words.length; i++) {
      if (!toks.every((t, k) => norm(words[i + k].text) === t)) continue;
      seen++;
      if (e.occurrence && e.occurrence !== "all" && e.occurrence !== seen) continue;
      if (marks.slice(i, i + toks.length).some(Boolean)) continue;
      g++;
      for (let k = 0; k < toks.length; k++) marks[i + k] = { group: g, style: e.style || defStyle, first: k === 0, sfx: e.sfx };
      if (e.occurrence !== "all") break; // default: first occurrence only — emphasis is strategic
    }
  }
  return marks;
}

export function buildCaptions(words, opts) {
  const o = { ...CAPTION_DEFAULTS, ...opts };
  const hide = new Set(o.hide.map(norm));
  let ws = words.filter((w) => !(o.hideFillers && HARD_FILLERS.has(norm(w.text))) && !hide.has(norm(w.text)));
  const marks = matchEmphasis(ws, o.emphasis, o.emphasisStyle);
  ws = ws.map((w, i) => ({ ...w, mark: marks[i] }));

  // Chunking
  const chunks = [];
  let cur = [];
  const flush = () => cur.length && (chunks.push(cur), (cur = []));
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], prev = cur.at(-1);
    const len = cur.reduce((a, x) => a + x.text.length + 1, 0);
    // keep an emphasis group together
    let groupLen = w.text.length;
    if (w.mark?.first) for (let k = i + 1; k < ws.length && ws[k].mark?.group === w.mark.group; k++) groupLen += ws[k].text.length + 1;
    const inGroup = prev && w.mark && prev.mark?.group === w.mark.group;
    const big = w.mark?.style === "big" && w.mark.first;
    if (prev && !inGroup && (
      cur.length >= o.maxWords ||
      len + groupLen > o.maxChars ||
      w.start - prev.end > 0.35 ||
      /[.?!,।;:]$/.test(prev.text) ||
      (o.breakOnCut && w.seg !== prev.seg) ||
      big || prev.mark?.style === "big"
    )) flush();
    cur.push(w);
  }
  flush();

  return chunks.map((ch, k) => {
    const start = ch[0].start;
    const nextStart = chunks[k + 1]?.[0].start ?? Infinity;
    const end = Math.min(nextStart, ch.at(-1).end + 0.45);
    return { start, end: Math.max(end, Math.min(start + 0.3, nextStart)), words: ch };
  });
}

const tcase = (s, c) => (c === "upper" ? s.toUpperCase() : c === "lower" ? s.toLowerCase() : s);

// → { html, js, srt } for the composition.
export function renderCaptions(chunks, opts, B) {
  const o = { ...CAPTION_DEFAULTS, ...opts };
  const size = Math.round(BASE_SIZE[o.style] * o.size);
  const strokeW = o.style === "punch" ? Math.round(11 * o.size) : 0;
  let html = "", js = "", srt = "";
  const at = (t) => t.toFixed(3);
  if (o.style === "tiktok") return renderTiktok(chunks, o, B, size);
  chunks.forEach((ch, k) => {
    const id = `cap-${k}`;
    const bn = ch.words.some((w) => BN.test(w.text));
    let inner = "", i = 0;
    while (i < ch.words.length) {
      const w = ch.words[i];
      if (w.mark) {
        const g = [];
        while (i < ch.words.length && ch.words[i].mark?.group === w.mark.group) g.push(ch.words[i++]);
        const st = w.mark.style;
        const deco = st === "box" || st === "ink" ? `<span class="deco-bg" data-layout-allow-overlap data-layout-allow-overflow id="${id}-g${w.mark.group}-bg"></span>` : st === "strike" ? `<span class="deco-strike" data-layout-allow-overlap data-layout-allow-overflow id="${id}-g${w.mark.group}-ln"></span>` : st === "underline" ? `<span class="deco-under" data-layout-allow-overlap data-layout-allow-overflow id="${id}-g${w.mark.group}-ln"></span>` : "";
        inner += `<span class="em em-${st === "big" ? "accent" : st} ${st === "big" ? "cap-big" : ""}" id="${id}-g${w.mark.group}">${deco}${g.map((x) => escapeHTML(tcase(x.text, o.case))).join(" ")}</span> `;
        // emphasis animation at the moment the phrase is spoken
        const t = Math.max(ch.start, g[0].start), gs = `#${id}-g${w.mark.group}`;
        if (st === "box" || st === "ink") {
          js += `tl.fromTo("${gs}-bg", { scaleX: 0 }, { scaleX: 1, duration: 0.16, ease: "power3.out" }, ${at(t)});\n`;
          if (o.style === "punch" && st === "box") js += `tl.fromTo("${gs}", { color: "#FFFFFF", webkitTextStrokeColor: "${B.ink}" }, { color: "${B.ink}", webkitTextStrokeColor: "${B.orange}", duration: 0.06, ease: "none" }, ${at(t)});\n`;
        }
        if (st === "accent" || st === "big") js += `tl.fromTo("${gs}", { color: "${o.style === "clean" ? B.ink : "#FFFFFF"}" }, { color: "${o.style === "clean" ? B.orange600 : B.orange}", duration: 0.08, ease: "none" }, ${at(t)});\n`;
        if (st === "underline") js += `tl.fromTo("${gs}-ln", { scaleX: 0 }, { scaleX: 1, duration: 0.22, ease: "power2.out" }, ${at(t)});\n`;
        if (st === "strike") js += `tl.fromTo("${gs}-ln", { scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "power2.out" }, ${at(Math.min(g.at(-1).end, ch.end - 0.2))});\n`;
        if (st !== "strike" && st !== "underline") js += `tl.fromTo("${gs}", { scale: 1.16 }, { scale: 1, duration: 0.3, ease: "back.out(3)", immediateRender: false }, ${at(t)});\n`;
      } else {
        inner += `<span class="w" id="${id}-w${i}">${escapeHTML(tcase(w.text, o.case))}</span> `;
        if (o.karaoke) js += `tl.fromTo("#${id}-w${i}", { opacity: 0.45 }, { opacity: 1, duration: 0.06, ease: "none" }, ${at(Math.max(ch.start, w.start))});\n`;
        i++;
      }
    }
    html += `<div id="${id}" class="clip cap cap-${o.style}" data-start="${at(ch.start)}" data-duration="${at(ch.end - ch.start)}" data-track-index="20"><div class="cap-box" style="top:${o.y}px"><div class="cap-in ${bn ? "bn" : ""}" id="${id}-in" style="font-size:${size}px;${strokeW ? `-webkit-text-stroke-width:${bn ? Math.round(strokeW * 0.65) : strokeW}px` : ""}">${inner.trim()}</div></div></div>\n`;
    js = `tl.fromTo("#${id}-in", { y: 18, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.14, ease: "power3.out" }, ${at(ch.start)});\n` + js;
    srt += `${k + 1}\n${srtTime(ch.start)} --> ${srtTime(ch.end)}\n${ch.words.map((w) => w.text).join(" ")}\n\n`;
  });
  return { html, js, srt };
}

// style "tiktok": the chunk sits on an ink plate; the word being spoken gets an orange pill (ink
// text) that jumps word to word. Emphasis: box = pill stays lit after the word · accent = orange
// text · strike = orange line through after it's said · big = own chunk, larger.
function renderTiktok(chunks, o, B, size) {
  let html = "", js = "", srt = "";
  const at = (t) => t.toFixed(3);
  chunks.forEach((ch, k) => {
    const id = `cap-${k}`;
    const bn = ch.words.some((w) => BN.test(w.text));
    const big = ch.words.some((w) => w.mark?.style === "big");
    const inner = ch.words.map((w, i) => {
      const st = w.mark?.style;
      return `<span class="w tw ${st ? `tw-${st}` : ""}" id="${id}-w${i}"><span class="tw-pill" data-layout-allow-overlap data-layout-allow-overflow id="${id}-p${i}"></span>${st === "strike" ? `<span class="deco-strike" data-layout-allow-overlap data-layout-allow-overflow id="${id}-s${i}"></span>` : ""}${escapeHTML(tcase(w.text, o.case))}</span>`;
    }).join(" ");
    html += `<div id="${id}" class="clip cap cap-tiktok" data-start="${at(ch.start)}" data-duration="${at(ch.end - ch.start)}" data-track-index="20"><div class="cap-box" style="top:${o.y}px"><div class="cap-in ${bn ? "bn" : ""}" id="${id}-in" style="font-size:${Math.round(size * (big ? 1.25 : 1))}px">${inner}</div></div></div>\n`;
    js += `tl.fromTo("#${id}-in", { y: 22, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.16, ease: "back.out(2)" }, ${at(ch.start)});\n`;
    ch.words.forEach((w, i) => {
      const st = w.mark?.style, t = Math.max(ch.start, w.start);
      const next = ch.words[i + 1] ? Math.max(t + 0.08, ch.words[i + 1].start) : null;
      const keep = st === "box" || st === "ink" || st === "big";
      const fg = st === "accent" ? B.orange : "#FFFFFF";
      js += `tl.fromTo("#${id}-p${i}", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.1, ease: "back.out(2.5)", immediateRender: false }, ${at(t)});\n`;
      js += `tl.fromTo("#${id}-w${i}", { color: "${fg}", scale: 1 }, { color: "${B.ink}", scale: 1.1, duration: 0.07, ease: "power2.out", immediateRender: false }, ${at(t)});\n`;
      js += `tl.fromTo("#${id}-w${i}", { scale: 1.1 }, { scale: 1, duration: 0.18, ease: "power2.out", immediateRender: false }, ${at(t + 0.07)});\n`;
      if (next !== null && !keep) {
        js += `tl.fromTo("#${id}-p${i}", { opacity: 1 }, { opacity: 0, duration: 0.06, ease: "none", immediateRender: false }, ${at(next)});\n`;
        js += `tl.fromTo("#${id}-w${i}", { color: "${B.ink}" }, { color: "${fg}", duration: 0.06, ease: "none", immediateRender: false }, ${at(next)});\n`;
      }
      if (st === "strike") js += `tl.fromTo("#${id}-s${i}", { scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "power2.out" }, ${at(next ?? Math.min(w.end, ch.end - 0.2))});\n`;
    });
    srt += `${k + 1}\n${srtTime(ch.start)} --> ${srtTime(ch.end)}\n${ch.words.map((w) => w.text).join(" ")}\n\n`;
  });
  return { html, js, srt };
}

function srtTime(t) {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
