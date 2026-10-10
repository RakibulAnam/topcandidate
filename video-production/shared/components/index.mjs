// TopCandidate motion components. Each component is a pure function:
//   (props, ctx) => { html, js, sfx?, z? }
// ctx = { id, t0, dur, sel, rich, esc, B }. `js` is GSAP code appended to the one paused
// timeline `tl` (seek-safe: only fromTo/to/set at absolute positions, no clocks, no random).
// Initial states live in fromTo, never in CSS transforms (HyperFrames lint rule).
// Product facts used as defaults come from apps/web/src/presentation/i18n/locales/{en,bn}.ts —
// don't invent features or numbers here.

const LOGO_PATHS = `
  <path class="lm-arc" pathLength="1" d="M147.5 60.1 A62 62 0 1 0 147.5 139.9" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round"/>
  <line class="lm-stem" pathLength="1" x1="100" y1="88" x2="100" y2="134" stroke="currentColor" stroke-width="18" stroke-linecap="round"/>
  <line class="lm-bar" pathLength="1" x1="74" y1="88" x2="166" y2="88" stroke="#E8743B" stroke-width="18" stroke-linecap="round"/>`;
const logoSvg = (color = "#0F1B2D") => `<svg class="mark" viewBox="24 24 156 152" style="color:${color}" aria-label="Top Candidate">${LOGO_PATHS}</svg>`;

// Real product deliverables (en.ts:1338-1347, bn.ts:1316-1324) + dashboard chip tints.
const TOOLKIT = {
  en: [["resume", "Tailored Resume", "ATS-ready"], ["cover", "Cover Letter", "250–400 words"], ["email", "Recruiter Email", ""], ["linkedin", "LinkedIn Note", "< 280 chars"], ["interview", "Interview Prep", "EN + বাংলা"]],
  bn: [["resume", "টেইলর-করা রিজিউমে", "ATS-ready"], ["cover", "কভার লেটার", ""], ["email", "রিক্রুটার ইমেইল", ""], ["linkedin", "LinkedIn নোট", ""], ["interview", "ইন্টারভিউ প্রস্তুতি", ""]],
};

const n = (v, d) => (v === undefined || v === null ? d : v);
const exit = (sel, t0, dur, d = 0.22) => (dur > 0.6 ? `tl.to("${sel}", { opacity: 0, y: -16, duration: ${d}, ease: "power2.in" }, ${(t0 + dur - d).toFixed(3)});` : "");
const at = (t) => Number(t).toFixed(3);
const isBn = (s) => /[ঀ-৿]/.test(String(s));

// Background options for anything that can sit full-frame over the speaker.
function bgLayer(id, bg) {
  if (!bg || bg === "none") return "";
  if (bg === "dim") return `<div class="dim" id="${id}-bg"></div>`;
  return `<div class="full-bg ${bg === "ink" || bg === "dark" ? "dark" : bg === "stone2" ? "stone2" : ""}" id="${id}-bg"></div>`;
}
const bgIn = (id, bg, t0) => (!bg || bg === "none" ? "" : `tl.fromTo("#${id}-bg", { opacity: 0 }, { opacity: 1, duration: 0.18, ease: "none" }, ${at(t0)});`);

export const components = {
  // ---------------------------------------------------------------- kinetic headline
  // { lines: ["Apnar CV *kharap na*."], eyebrow?, style: boxed|plain|serif, align: center|left, y: 300, bg: none|dim|stone|ink, inkLines?: [1], size?: px }
  title(p, c) {
    const style = n(p.style, "boxed"), align = n(p.align, "center"), y = n(p.y, 300), bg = n(p.bg, "none");
    const lines = (p.lines || [p.text || ""]).map((l, i) => `<div class="t-line"><span class="t-txt ${(p.inkLines || []).includes(i) ? "ink" : ""} ${isBn(l) ? "bn" : ""}" id="${c.id}-l${i}"${p.size ? ` style="font-size:${p.size}px"` : ""}>${c.rich(l)}</span></div>`).join("");
    const html = `${bgLayer(c.id, bg)}<div class="title-wrap title-${style} ${align} ${bg === "ink" ? "on-dark" : ""}" style="top:${y}px">${p.eyebrow ? `<div class="eyebrow" id="${c.id}-eb">${c.esc(p.eyebrow)}</div>` : ""}${lines}</div>`;
    const stagger = n(p.stagger, 0.12);
    const js = [
      bgIn(c.id, bg, c.t0),
      p.eyebrow ? `tl.fromTo("#${c.id}-eb", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, ${at(c.t0)});` : "",
      ...(p.lines || [p.text]).map((_, i) => `tl.fromTo("#${c.id}-l${i}", { yPercent: 115 }, { yPercent: 0, duration: 0.38, ease: "power4.out" }, ${at(c.t0 + 0.05 + i * stagger)});`),
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "whoosh-short" };
  },

  // ---------------------------------------------------------------- pop label
  // { text, tone: ink|orange|stone, icon: x|check|arrow|!|none, x: 540 (center), y: 520, rotate: -4 }
  sticker(p, c) {
    const icons = { x: "✕", check: "✓", arrow: "→", "!": "!" };
    const ic = p.icon && icons[p.icon] ? `<span class="ic">${icons[p.icon]}</span>` : "";
    const html = `<div class="sticker ${n(p.tone, "ink")} ${isBn(p.text) ? "bn" : ""}" id="${c.id}-s" style="left:${n(p.x, 540)}px;top:${n(p.y, 520)}px">${ic}<span>${c.rich(p.text)}</span></div>`;
    const js = `tl.fromTo("#${c.id}-s", { xPercent: -50, scale: 0, rotation: ${n(p.rotate, -4) - 10} }, { xPercent: -50, scale: 1, rotation: ${n(p.rotate, -4)}, duration: 0.42, ease: "back.out(2.2)" }, ${at(c.t0)});\n${exit(`#${c.id}-s`, c.t0, c.dur)}`;
    return { html, js, sfx: "pop" };
  },

  // ---------------------------------------------------------------- hand-drawn arrow
  // { from: [x,y], to: [x,y], bend: 0.25, color, width: 12 }
  arrow(p, c) {
    const [x1, y1] = p.from || [300, 700], [x2, y2] = p.to || [600, 1000];
    const bend = n(p.bend, 0.25), mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const ang = Math.atan2(y2 - my, x2 - mx), L = 46, sp = 0.5;
    const h1 = [x2 - L * Math.cos(ang - sp), y2 - L * Math.sin(ang - sp)], h2 = [x2 - L * Math.cos(ang + sp), y2 - L * Math.sin(ang + sp)];
    const col = n(p.color, "#E8743B"), w = n(p.width, 12);
    const html = `<svg class="annot" viewBox="0 0 1080 1920"><path id="${c.id}-p" pathLength="1" d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="1"/><path id="${c.id}-h" pathLength="1" d="M${h1} L${x2} ${y2} L${h2}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/></svg>`;
    const js = `tl.fromTo("#${c.id}-p", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.35, ease: "power2.inOut" }, ${at(c.t0)});\ntl.fromTo("#${c.id}-h", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.15, ease: "power2.out" }, ${at(c.t0 + 0.32)});\n${exit(`#${c.id} .ov-in`, c.t0, c.dur)}`;
    return { html, js, sfx: "whoosh-short" };
  },

  // ---------------------------------------------------------------- scribble circle
  // { x, y (center), w, h, color, width: 10 }
  circle(p, c) {
    const cx = n(p.x, 540), cy = n(p.y, 900), rx = n(p.w, 420) / 2, ry = n(p.h, 160) / 2;
    // Slightly overshooting ellipse (≈1.1 turns) reads as hand-drawn.
    const pts = [];
    for (let i = 0; i <= 44; i++) {
      const a = -Math.PI * 0.6 + (i / 44) * Math.PI * 2.2, wob = 1 + 0.035 * Math.sin(i * 1.7);
      pts.push(`${(cx + rx * wob * Math.cos(a)).toFixed(1)} ${(cy + ry * wob * Math.sin(a)).toFixed(1)}`);
    }
    const html = `<svg class="annot" viewBox="0 0 1080 1920"><path id="${c.id}-c" pathLength="1" d="M${pts.join(" L")}" fill="none" stroke="${n(p.color, "#E8743B")}" stroke-width="${n(p.width, 10)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/></svg>`;
    const js = `tl.fromTo("#${c.id}-c", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, ease: "power2.inOut" }, ${at(c.t0)});\n${exit(`#${c.id} .ov-in`, c.t0, c.dur)}`;
    return { html, js, sfx: "whoosh-short" };
  },

  // ---------------------------------------------------------------- rectangle marker
  // { x, y, w, h (top-left box), style: box|underline, color }
  highlight(p, c) {
    const x = n(p.x, 100), y = n(p.y, 800), w = n(p.w, 600), h = n(p.h, 120), col = n(p.color, "#E8743B");
    const d = p.style === "underline" ? `M${x} ${y + h} L${x + w} ${y + h}` : `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;
    const html = `<svg class="annot" viewBox="0 0 1080 1920"><path id="${c.id}-r" pathLength="1" d="${d}" fill="none" stroke="${col}" stroke-width="${n(p.width, 10)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/></svg>`;
    const js = `tl.fromTo("#${c.id}-r", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.inOut" }, ${at(c.t0)});\n${exit(`#${c.id} .ov-in`, c.t0, c.dur)}`;
    return { html, js };
  },

  // ---------------------------------------------------------------- push notification
  // { app: "Email", letter: "E", title, body, time: "now", y: 240 }
  notification(p, c) {
    const html = `<div class="card notif" id="${c.id}-n" style="top:${n(p.y, 240)}px"><div class="app">${c.esc(n(p.letter, (p.app || "E")[0]))}</div><div><div class="nt">${c.rich(n(p.title, p.app || "New message"))}</div><div class="nb">${c.rich(p.body || "")}</div></div><div class="time">${c.esc(n(p.time, "now"))}</div></div>`;
    const js = `tl.fromTo("#${c.id}-n", { yPercent: -140, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: "back.out(1.4)" }, ${at(c.t0)});\n${c.dur > 0.6 ? `tl.to("#${c.id}-n", { yPercent: -140, opacity: 0, duration: 0.3, ease: "power2.in" }, ${at(c.t0 + c.dur - 0.3)});` : ""}`;
    return { html, js, sfx: "notification" };
  },

  // ---------------------------------------------------------------- job post card
  // { title, company, location, tags: [], posted: "2d ago", applicants: "300+ applied", y: 300, logo: "A" }
  "job-post"(p, c) {
    const tags = (p.tags || []).map((t, i) => `<span class="tag" id="${c.id}-t${i}">${c.esc(t)}</span>`).join("");
    const html = `<div class="card job" id="${c.id}-j" style="top:${n(p.y, 300)}px"><div class="head"><div class="logo">${c.esc(n(p.logo, (p.company || "J")[0]))}</div><div><h3>${c.rich(p.title || "Marketing Executive")}</h3><div class="co">${c.esc([p.company, p.location].filter(Boolean).join(" · "))}</div></div></div>${tags ? `<div class="tags">${tags}</div>` : ""}<div class="foot"><span>${c.esc(p.posted || "")}</span><b>${c.esc(p.applicants || "")}</b></div></div>`;
    const js = [
      `tl.fromTo("#${c.id}-j", { y: 80, opacity: 0, rotation: 2 }, { y: 0, opacity: 1, rotation: 0, duration: 0.5, ease: "power3.out" }, ${at(c.t0)});`,
      ...(p.tags || []).map((_, i) => `tl.fromTo("#${c.id}-t${i}", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out" }, ${at(c.t0 + 0.3 + i * 0.07)});`),
      exit(`#${c.id}-j`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "whoosh" };
  },

  // ---------------------------------------------------------------- resume mock
  // { state: tailored|generic, name, role, badge, chip, bullets: [], stamp: "Same CV", y: 280, lines: 3 }
  resume(p, c) {
    const gen = p.state === "generic";
    const name = n(p.name, "Tahmid Hasan"), role = n(p.role, "Marketing Officer · Dhaka"); // landing hero mock, en.ts:1326
    const bullets = (p.bullets || []).map((b, i) => `<div class="bul" id="${c.id}-b${i}">${c.rich(b)}</div>`).join("");
    const lines = Array.from({ length: n(p.lines, gen ? 6 : 2) }, (_, i) => `<div class="ln" style="width:${[92, 78, 86, 64, 88, 72][i % 6]}%"></div>`).join("");
    const html = `<div class="card resume ${gen ? "generic" : ""}" id="${c.id}-r" style="top:${n(p.y, 280)}px">${!gen ? `<div class="badge">${c.esc(n(p.badge, "ATS-ready"))}</div>` : ""}<div class="rn">${c.esc(name)}</div><div class="rr">${c.esc(role)}</div><div class="sec">Experience</div>${bullets}${lines}${!gen ? `<div class="chip" id="${c.id}-chip">✓ ${c.esc(n(p.chip, "Tailored to the job post"))}</div>` : ""}</div>${p.stamp ? `<div class="stamp" id="${c.id}-st" style="top:${n(p.y, 280) + 140}px;left:${n(p.stampX, 560)}px">${c.rich(p.stamp)}</div>` : ""}`;
    const js = [
      `tl.fromTo("#${c.id}-r", { y: 90, opacity: 0, rotation: ${gen ? -3 : 0} }, { y: 0, opacity: 1, rotation: ${gen ? -1.5 : 0}, duration: 0.5, ease: "power3.out" }, ${at(c.t0)});`,
      ...(p.bullets || []).map((_, i) => `tl.fromTo("#${c.id}-b${i}", { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.25, ease: "power2.out" }, ${at(c.t0 + 0.35 + i * 0.12)});`),
      !gen ? `tl.fromTo("#${c.id}-chip", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2)" }, ${at(c.t0 + 0.5 + (p.bullets || []).length * 0.12)});` : "",
      p.stamp ? `tl.fromTo("#${c.id}-st", { scale: 2.2, opacity: 0, rotation: -14 }, { scale: 1, opacity: 1, rotation: -9, duration: 0.28, ease: "power4.in" }, ${at(c.t0 + n(p.stampAt, 0.6))});` : "",
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "whoosh" };
  },

  // ---------------------------------------------------------------- chat / recruiter message
  // { who: "HR — ABC Group", channel: "LinkedIn", messages: [{ from: them|me, text }], y: 300, gap: 0.5 }
  message(p, c) {
    const msgs = (p.messages || [{ from: "them", text: p.text || "" }]).map((m, i) => `<div class="bubble ${m.from === "me" ? "me" : "them"} ${isBn(m.text) ? "bn" : ""}" id="${c.id}-m${i}">${c.rich(m.text)}</div>`).join("");
    const html = `<div class="card msgs" id="${c.id}-c" style="top:${n(p.y, 300)}px"><div class="mh"><div class="av">${c.esc(n(p.letter, (p.who || "R")[0]))}</div><div><div class="who">${c.esc(n(p.who, "Recruiter"))}</div><div class="ch">${c.esc(n(p.channel, ""))}</div></div></div>${msgs}</div>`;
    const js = [
      `tl.fromTo("#${c.id}-c", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0)});`,
      ...(p.messages || [1]).map((_, i) => `tl.fromTo("#${c.id}-m${i}", { opacity: 0, y: 20, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(1.6)" }, ${at(c.t0 + 0.3 + i * n(p.gap, 0.6))});`),
      exit(`#${c.id}-c`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "ping" };
  },

  // ---------------------------------------------------------------- before / after
  // { left: { label, items: [] }, right: { label, items: [] }, y: 300, rightAt: 0.9 }
  compare(p, c) {
    const col = (side, cls, mark) => `<div class="col ${cls}" id="${c.id}-${cls}"><div class="lab">${c.esc(side.label)}</div>${(side.items || []).map((t, i) => `<div class="it" id="${c.id}-${cls}${i}"><span class="mk">${mark}</span><span>${c.rich(t)}</span></div>`).join("")}</div>`;
    const L = p.left || { label: "Before", items: [] }, R = p.right || { label: "After", items: [] };
    const html = `<div class="cmp" style="top:${n(p.y, 300)}px">${col(L, "bad", "✕")}${col(R, "good", "✓")}</div>`;
    const rAt = c.t0 + n(p.rightAt, 0.9);
    const js = [
      `tl.fromTo("#${c.id}-bad", { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0)});`,
      ...(L.items || []).map((_, i) => `tl.fromTo("#${c.id}-bad${i}", { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${at(c.t0 + 0.2 + i * 0.1)});`),
      `tl.fromTo("#${c.id}-good", { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(rAt)});`,
      ...(R.items || []).map((_, i) => `tl.fromTo("#${c.id}-good${i}", { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: 0.22 }, ${at(rAt + 0.2 + i * 0.12)});`),
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "whoosh-short" };
  },

  // ---------------------------------------------------------------- progress bar
  // { label, from: 0, to: 86, suffix: "%", y: 340, dark: false, fill: 0.9 }
  progress(p, c) {
    const from = n(p.from, 0), to = n(p.to, 100), suf = n(p.suffix, "%");
    const html = `<div class="card prog ${p.dark ? "dark" : ""}" id="${c.id}-c" style="top:${n(p.y, 340)}px"><div class="row"><div class="pl">${c.rich(n(p.label, "Match"))}</div><div class="pv" id="${c.id}-v">${from}${c.esc(suf)}</div></div><div class="track"><div class="fill" id="${c.id}-f"></div></div></div>`;
    const d = n(p.fill, 0.9);
    const js = [
      `tl.fromTo("#${c.id}-c", { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ${at(c.t0)});`,
      `tl.fromTo("#${c.id}-f", { scaleX: ${from / 100} }, { scaleX: ${to / 100}, duration: ${d}, ease: "power2.inOut" }, ${at(c.t0 + 0.25)});`,
      `(() => { const o = { v: ${from} }, el = document.getElementById("${c.id}-v"); tl.fromTo(o, { v: ${from} }, { v: ${to}, duration: ${d}, ease: "power2.inOut", onUpdate: () => { el.textContent = Math.round(o.v) + ${JSON.stringify(suf)}; } }, ${at(c.t0 + 0.25)}); })();`,
      exit(`#${c.id}-c`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "sparkle" };
  },

  // ---------------------------------------------------------------- big number
  // { from: 0, to: 20, prefix: "", suffix: "", unit: "ta job", label, y: 520, digits: en|bn, onLight: false, count: 0.8 }
  counter(p, c) {
    const bnD = (s) => String(s).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
    const fmtFn = p.digits === "bn" ? `(s) => String(s).replace(/\\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d])` : `(s) => String(s)`;
    const from = n(p.from, 0), to = n(p.to, 10), pre = n(p.prefix, ""), suf = n(p.suffix, "");
    const show = (v) => (p.digits === "bn" ? bnD(v) : v);
    const html = `${bgLayer(c.id, p.bg)}<div class="counter-wrap" style="top:${n(p.y, 520)}px"><div class="counter-num ${p.onLight || p.bg === "stone" ? "on-light" : ""}" id="${c.id}-n">${c.esc(pre)}<span id="${c.id}-v">${show(from)}</span>${c.esc(suf)}${p.unit ? `<span class="u"> ${c.esc(p.unit)}</span>` : ""}</div>${p.label ? `<div class="counter-label ${isBn(p.label) ? "bn" : ""}" id="${c.id}-l">${c.rich(p.label)}</div>` : ""}</div>`;
    const cd = n(p.count, 0.8);
    const js = [
      bgIn(c.id, p.bg, c.t0),
      `tl.fromTo("#${c.id}-n", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(1.8)" }, ${at(c.t0)});`,
      `(() => { const f = ${fmtFn}, o = { v: ${from} }, el = document.getElementById("${c.id}-v"); tl.fromTo(o, { v: ${from} }, { v: ${to}, duration: ${cd}, ease: "power2.out", onUpdate: () => { el.textContent = f(Math.round(o.v)); } }, ${at(c.t0 + 0.1)}); })();`,
      p.label ? `tl.fromTo("#${c.id}-l", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" }, ${at(c.t0 + cd * 0.7)});` : "",
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "pop" };
  },

  // ---------------------------------------------------------------- the 5-deliverable toolkit (real product)
  // { lang: en|bn, eyebrow, title, y: 260, only?: ["resume","cover"], highlight?: "resume", bg: none|dim|ink }
  toolkit(p, c) {
    const lang = n(p.lang, "en"), items = TOOLKIT[lang].filter(([k]) => !p.only || p.only.includes(k));
    const chips = items.map(([k, label, sub], i) => {
      const t = c.B.chips[k];
      return `<div class="chip ${lang === "bn" ? "bn" : ""}" id="${c.id}-c${i}" style="color:${t.fg};background:${t.bg};border-color:${p.highlight === k ? t.fg : t.bd}"><span class="dot"></span><span>${c.esc(label)}</span>${sub ? `<span class="sub">${c.esc(sub)}</span>` : ""}</div>`;
    }).join("");
    const eyebrow = n(p.eyebrow, lang === "bn" ? "এক পেস্টে, পাঁচটি জিনিস" : "One paste, five deliverables");
    const title = n(p.title, lang === "bn" ? "একটি জব পোস্ট। পাঁচটি অংশ, একই গল্প।" : "One job post. A complete application.");
    const html = `${bgLayer(c.id, p.bg)}<div class="card dark kit" id="${c.id}-k" style="top:${n(p.y, 260)}px"><div class="eyebrow ${lang === "bn" ? "bn" : ""}">${c.esc(eyebrow)}</div><h4 class="${lang === "bn" ? "bn" : ""}">${c.rich(title)}</h4>${chips}</div>`;
    const js = [
      bgIn(c.id, p.bg, c.t0),
      `tl.fromTo("#${c.id}-k", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, ${at(c.t0)});`,
      ...items.map((_, i) => `tl.fromTo("#${c.id}-c${i}", { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.28, ease: "power3.out" }, ${at(c.t0 + 0.3 + i * n(p.stagger, 0.12))});`),
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "whoosh" };
  },

  // ---------------------------------------------------------------- product screenshot reveal
  // { src: "ui/landing-mobile.png" (resolved by build), frame: phone|browser|none, url, y, scroll: px, bg: stone|ink|none, height }
  screenshot(p, c) {
    const frame = n(p.frame, "phone"), scroll = n(p.scroll, 0), bg = n(p.bg, "stone");
    const img = `<img class="shot-img" id="${c.id}-img" src="${c.esc(p.src)}" alt="">`;
    let body;
    if (frame === "phone") body = `<div class="shot-phone" id="${c.id}-f" style="top:${n(p.y, 300)}px"><div class="notch"></div><div class="scr">${img}</div></div>`;
    else if (frame === "browser") body = `<div class="shot-browser" id="${c.id}-f" style="top:${n(p.y, 420)}px"><div class="bar"><span class="dotx"></span><span class="dotx"></span><span class="dotx"></span><span class="url">${c.esc(n(p.url, c.B.url))}</span></div><div class="scr" style="height:${n(p.height, 900)}px">${img}</div></div>`;
    else body = `<div class="shot-plain" id="${c.id}-f" style="top:${n(p.y, 360)}px">${img}</div>`;
    const js = [
      bgIn(c.id, bg, c.t0),
      `tl.fromTo("#${c.id}-f", { y: 140, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: "power3.out" }, ${at(c.t0)});`,
      scroll ? `tl.fromTo("#${c.id}-img", { y: 0 }, { y: -${scroll}, duration: ${Math.max(0.5, c.dur - 1.1)}, ease: "power1.inOut" }, ${at(c.t0 + 0.6)});` : "",
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html: bgLayer(c.id, bg) + body, js: js.join("\n"), sfx: "whoosh" };
  },

  // ---------------------------------------------------------------- price comparison (en.ts:1364-1372)
  // { lang: en|bn, rows?: [[label, value]], win?: [label, value], y: 380, bg }
  price(p, c) {
    const rows = p.rows || [["CV writer in Dhaka", "৳2,000–3,500"], ["Subscription", "৳800+/mo"]];
    const win = p.win || ["TOP CANDIDATE · 5 applications", "৳200"];
    const html = `${bgLayer(c.id, p.bg)}<div class="card price" id="${c.id}-c" style="top:${n(p.y, 380)}px"><div class="eyebrow">${c.esc(n(p.eyebrow, "What it costs"))}</div>${rows.map(([k, v], i) => `<div class="prow old" id="${c.id}-r${i}"><span class="pk">${c.esc(k)}</span><span class="pv">${c.esc(v)}<span class="strike" id="${c.id}-s${i}"></span></span></div>`).join("")}<div class="prow win" id="${c.id}-w"><span>${c.esc(win[0])}</span><span class="pv">${c.esc(win[1])}</span></div></div>`;
    const js = [
      bgIn(c.id, p.bg, c.t0),
      `tl.fromTo("#${c.id}-c", { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0)});`,
      ...rows.map((_, i) => `tl.fromTo("#${c.id}-s${i}", { scaleX: 0 }, { scaleX: 1, duration: 0.25, ease: "power2.out" }, ${at(c.t0 + 0.5 + i * 0.25)});`),
      `tl.fromTo("#${c.id}-w", { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.8)" }, ${at(c.t0 + 0.6 + rows.length * 0.25)});`,
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "pop" };
  },

  // ---------------------------------------------------------------- how it works (en.ts "Three steps. About a minute.")
  // { lang, steps?: [], eyebrow, y: 360 }
  steps(p, c) {
    const st = p.steps || (p.lang === "bn" ? ["জব পোস্ট পেস্ট করুন", "আমরা সবকিছু টেইলর করি", "ডাউনলোড, পাঠান, প্রস্তুতি নিন"] : ["Paste the job post", "We tailor everything", "Download, send, prepare"]);
    const html = `${bgLayer(c.id, p.bg)}<div class="card steps" id="${c.id}-c" style="top:${n(p.y, 360)}px"><div class="eyebrow">${c.esc(n(p.eyebrow, p.lang === "bn" ? "তিনটি ধাপ। প্রায় এক মিনিট।" : "Three steps. About a minute."))}</div>${st.map((s, i) => `<div class="st" id="${c.id}-s${i}"><div class="n">${i + 1}</div><div class="sx ${isBn(s) ? "bn" : ""}">${c.rich(s)}</div></div>`).join("")}</div>`;
    const js = [
      bgIn(c.id, p.bg, c.t0),
      `tl.fromTo("#${c.id}-c", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0)});`,
      ...st.map((_, i) => `tl.fromTo("#${c.id}-s${i}", { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, ${at(c.t0 + 0.3 + i * n(p.stagger, 0.35))});`),
      exit(`#${c.id} .ov-in`, c.t0, c.dur),
    ];
    return { html, js: js.join("\n"), sfx: "click" };
  },

  // ---------------------------------------------------------------- lower third
  // { name, handle, y: 1300 }
  "lower-third"(p, c) {
    const html = `<div class="l3" style="top:${n(p.y, 1280)}px"><div class="nm" id="${c.id}-a">${c.esc(p.name || "")}</div>${p.handle ? `<div class="hd" id="${c.id}-b">${c.esc(p.handle)}</div>` : ""}</div>`;
    const js = `tl.fromTo("#${c.id}-a", { x: -80, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0)});\n${p.handle ? `tl.fromTo("#${c.id}-b", { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ${at(c.t0 + 0.12)});` : ""}\n${exit(`#${c.id} .ov-in`, c.t0, c.dur)}`;
    return { html, js };
  },

  // ---------------------------------------------------------------- logo sting
  // { y: 760, bg: stone|ink|none, size: 1 }
  logo(p, c) {
    const bg = n(p.bg, "stone"), dark = bg === "ink";
    const html = `${bgLayer(c.id, bg)}<div class="brand-lockup ${dark ? "on-dark" : ""}" style="top:${n(p.y, 760)}px">${logoSvg(dark ? "#FAFAF7" : "#0F1B2D")}<div class="wordmark" id="${c.id}-wm"><span class="w1">TOP</span> <span class="w2">CANDIDATE</span></div></div>`;
    const js = [bgIn(c.id, bg, c.t0), drawLogo(`#${c.id}`, c.t0 + 0.1), `tl.fromTo("#${c.id}-wm", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${at(c.t0 + 0.6)});`, exit(`#${c.id} .ov-in`, c.t0, c.dur)];
    return { html, js: js.join("\n"), sfx: "sparkle" };
  },

  // ---------------------------------------------------------------- CTA end card (en.ts final CTA)
  // { lang: en|bn, headline, button, sub, url, bg: stone|ink }
  cta(p, c) {
    const bn = p.lang === "bn";
    const head = n(p.headline, bn ? "সব জায়গায় একই রিজিউমে পাঠানো *বন্ধ করুন*।" : "Stop sending the *same resume* everywhere.");
    const btn = n(p.button, bn ? "ফ্রিতে শুরু করুন" : "Start free");
    const sub = n(p.sub, bn ? "প্রথম আবেদন ফ্রি · ৫টি আবেদন মাত্র ৳২০০ · bKash-এ পেমেন্ট" : "First application free · ৳200 for 5 applications · Pay with bKash");
    const html = `<div class="full-bg" id="${c.id}-bg"></div><div class="brand-lockup" style="top:300px">${logoSvg()}<div class="wordmark" id="${c.id}-wm"><span class="w1">TOP</span> <span class="w2">CANDIDATE</span></div></div><div class="cta-head ${isBn(head) ? "bn" : ""}" id="${c.id}-h" style="top:760px">${c.rich(head)}</div><div class="cta-btn ${isBn(btn) ? "bn" : ""}" id="${c.id}-b" style="top:1130px">${c.esc(btn)} <span class="arr">→</span></div><div class="cta-url" id="${c.id}-u" style="top:1300px">${c.esc(n(p.url, c.B.url))}</div><div class="cta-sub ${isBn(sub) ? "bn" : ""}" id="${c.id}-s" style="top:1380px">${c.esc(sub)}</div><div class="cta-bar" id="${c.id}-bar"></div>`;
    const js = [
      `tl.fromTo("#${c.id}-bg", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, ${at(c.t0)});`,
      drawLogo(`#${c.id}`, c.t0 + 0.1),
      `tl.fromTo("#${c.id}-wm", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ${at(c.t0 + 0.45)});`,
      `tl.fromTo("#${c.id}-h", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, ${at(c.t0 + 0.6)});`,
      `tl.fromTo("#${c.id}-b", { xPercent: -50, scale: 0.7, opacity: 0 }, { xPercent: -50, scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2)" }, ${at(c.t0 + 0.95)});`,
      `tl.fromTo("#${c.id}-u", { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${at(c.t0 + 1.15)});`,
      `tl.fromTo("#${c.id}-s", { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${at(c.t0 + 1.3)});`,
      `tl.fromTo("#${c.id}-bar", { scaleX: 0 }, { scaleX: 1, duration: ${Math.max(0.6, c.dur - 0.4).toFixed(2)}, ease: "none" }, ${at(c.t0 + 0.2)});`,
    ];
    return { html, js: js.join("\n"), sfx: "impact-bass-1", z: 60 };
  },

  // ---------------------------------------------------------------- B-roll / image cut-away
  // { src, kind: video|image (auto), mediaStart: 0, zone: full|upper|pip, kenburns: true, volume: 0 }
  // Video b-roll is emitted by build.mjs as an untimed wrapper + a timed <video> (HyperFrames
  // forbids a timed <video> inside another timed element), so this handles images only.
  broll(p, c) {
    const zone = n(p.zone, "full");
    const box = zone === "full" ? "left:0;top:0;width:1080px;height:1920px" : zone === "upper" ? "left:0;top:0;width:1080px;height:1000px" : "left:520px;top:260px;width:460px;height:620px";
    const html = `<div class="broll-wrap ${zone === "pip" ? "pip" : ""}" id="${c.id}-w" style="${box}"><img id="${c.id}-img" src="${c.esc(p.src)}" alt=""></div>`;
    const js = [
      `tl.fromTo("#${c.id}-w", { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none" }, ${at(c.t0)});`,
      n(p.kenburns, true) ? `tl.fromTo("#${c.id}-img", { scale: 1.04 }, { scale: 1.16, duration: ${c.dur.toFixed(2)}, ease: "none" }, ${at(c.t0)});` : "",
    ];
    return { html, js: js.join("\n") };
  },
};

function drawLogo(scope, t) {
  return [
    `tl.fromTo("${scope} .lm-arc", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" }, ${at(t)});`,
    `tl.fromTo("${scope} .lm-stem", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, duration: 0.2, ease: "power2.out" }, ${at(t + 0.35)});`,
    `tl.fromTo("${scope} .lm-bar", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDasharray: 1, strokeDashoffset: 0, duration: 0.25, ease: "power2.out" }, ${at(t + 0.45)});`,
  ].join("\n");
}

export const COMPONENT_NAMES = Object.keys(components);
