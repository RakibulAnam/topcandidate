// Generates the "resume being written on a desk" Lottie scene shown on the
// first profile-setup screen (components/profile/ResumeWritingHero.tsx).
//
//   node scripts/build-onboarding-scene.mjs public/onboarding/resume-writing.json
//
// Edit this file, never the JSON: the JSON is per-frame keyframes.
// Everything the pen does is computed per frame from the same progress
// function that drives each stroke's trim path, so the nib never drifts off
// the ink.
import { writeFileSync } from 'node:fs';

const FR = 30;
const W = 640;
const H = 440;

// ---- palette (TopCandidate tokens) ----
const hex = (h, a = 1) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a].map(v => +v.toFixed(4));
};
const C = {
  wood: hex('#D9BC93'),
  grain: hex('#C7A577'),
  paper: hex('#FFFFFF'),
  shadow: hex('#0F1B2D'),
  ink: hex('#0F1B2D'),
  inkSoft: hex('#3A4A64'),
  line: hex('#9F998A'),
  rule: hex('#CFCBBC'),
  accent: hex('#E8743B'),
  accent100: hex('#FADCCB'),
  accent300: hex('#F09E74'),
  accent800: hex('#6B3014'),
  accent700: hex('#9C461D'),
  cream: hex('#FAFAF7'),
  stone: hex('#E5E2D8'),
  metal: hex('#9F998A'),
  metalDark: hex('#4D4A40'),
};

// ---- easing ----
const bezier = (x1, y1, x2, y2) => t => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // solve x(u) = t by Newton, then return y(u)
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3 - t;
    const dx = 3 * (1 - u) ** 2 * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
    u = Math.min(1, Math.max(0, u));
  }
  return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3;
};
const settleSoft = bezier(0, 0.65, 0.51, 0.99);
const travel = bezier(0.6, 0.05, 0.25, 1); // pen travel / hops
const exitAccel = bezier(0.5, 0, 0.75, 0.3); // leaving the frame: slow start, fast exit
const stroke = bezier(0.35, 0.1, 0.55, 1); // a written stroke: quick start, slight ease into the end

// ---- lottie helpers ----
const st = k => ({ a: 0, k });
const LIN = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
const keys = list => ({
  a: 1,
  k: list.map(([t, s, ease], idx) => {
    const kf = { t, s: Array.isArray(s) ? s : [s] };
    if (idx < list.length - 1) {
      const e = ease ?? LIN;
      kf.o = e.o;
      kf.i = e.i;
    }
    return kf;
  }),
});
const holdKeys = list => ({
  a: 1,
  k: list.map(([t, s]) => ({ t, s: Array.isArray(s) ? s : [s], h: 1 })),
});
const ez = (x1, y1, x2, y2) => ({ o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] } });
const tr = (o = {}) => ({
  ty: 'tr',
  p: o.p ?? st([0, 0]),
  a: o.a ?? st([0, 0]),
  s: o.s ?? st([100, 100]),
  r: o.r ?? st(0),
  o: o.o ?? st(100),
  sk: st(0),
  sa: st(0),
});
const fill = c => ({ ty: 'fl', c: st(c), o: st(100), r: 1 });
const strokeStyle = (c, w) => ({ ty: 'st', c: st(c), o: st(100), w: st(w), lc: 2, lj: 2, ml: 4 });
const rect = (x, y, w, h, r = 0) => ({ ty: 'rc', d: 1, p: st([x, y]), s: st([w, h]), r: st(r) });
const ellipse = (x, y, w, h) => ({ ty: 'el', d: 1, p: st([x, y]), s: st([w, h]) });
const poly = (pts, closed = false) => ({
  ty: 'sh',
  ks: st({ i: pts.map(() => [0, 0]), o: pts.map(() => [0, 0]), v: pts, c: closed }),
});
const group = (nm, it, t) => ({ ty: 'gr', nm, it: [...it, tr(t)] });

// ---- geometry: polylines measured by arc length ----
const measure = pts => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
};
const pointAt = (pts, cum, f) => {
  const L = cum[cum.length - 1];
  const d = f * L;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = (d - cum[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
};

// Handwritten word: per-letter strokes (arch, loop, ascender, descender)
// joined into one slanted cursive line, so it reads as a signature-style name
// rather than a uniform spring.
const scribble = (x0, x1, y, letters, seed) => {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const kinds = ['cap'];
  for (let i = 1; i < letters; i++) {
    const r = rnd();
    kinds.push(r < 0.18 ? 'asc' : r < 0.3 ? 'desc' : r < 0.62 ? 'loop' : 'arch');
  }
  const widths = kinds.map(k => (k === 'cap' ? 1.5 : k === 'arch' ? 1.1 : 0.8 + rnd() * 0.4));
  const total = widths.reduce((a, b) => a + b, 0);
  const X = 6; // x-height
  const pts = [[x0 - 3, y + 1]];
  let cx = x0;
  kinds.forEach((k, i) => {
    const w = (widths[i] / total) * (x1 - x0);
    const N = 16;
    for (let j = 1; j <= N; j++) {
      const u = j / N;
      const ph = u * Math.PI * 2;
      let dx = w * u;
      let dy;
      if (k === 'cap') { dy = -X * 2.6 * Math.sin(Math.PI * u) ** 0.7; dx -= Math.sin(ph) * w * 0.35; }
      else if (k === 'asc') { dy = -X * 2.3 * Math.sin(Math.PI * u) ** 2; dx -= Math.sin(ph) * w * 0.45; }
      else if (k === 'desc') { dy = X * 1.9 * Math.sin(Math.PI * u) ** 2 - X * 0.4 * Math.sin(Math.PI * u); dx -= Math.sin(ph) * w * 0.4; }
      else if (k === 'loop') { dy = -X * (1 - Math.cos(ph)) * 0.5; dx -= Math.sin(ph) * w * 0.55; }
      else { dy = -X * Math.abs(Math.sin(ph)); }
      const yy = y + dy;
      const slant = (y - yy) * 0.28; // forward lean
      pts.push([+(cx + dx + slant).toFixed(2), +yy.toFixed(2)]);
    }
    cx += w;
  });
  pts.push([x1 + 5, y - 1.5]);
  return pts;
};

// ---- the sheet (A4, portrait) in paper-local coordinates ----
const PW = 272;
const PH = Math.round(PW * 1.4142); // 385
const PX = 312; // settled centre on the desk
const PY = 222;
const L = -110; // text column
const R = 110;

// Strokes the pen writes, in order. Each: {pts, color, width, dur}
const strokes = [];
const S = (nm, pts, color, width, dur, opts = {}) => strokes.push({ nm, pts, color, width, dur, ...opts });

S('name-first', scribble(L, L + 70, -142, 6, 7), C.ink, 3.1, 11, { hopAfter: 3 });
S('name-last', scribble(L + 84, L + 166, -142, 7, 31), C.ink, 3.1, 11);
S('headline', [[L, -120], [L + 96, -120]], C.accent, 2.6, 5);
S('contact', [[L, -106], [L + 166, -106]], C.line, 1.7, 5);

const sections = [
  { y: -72, bullets: [L + 206, L + 168, L + 192] }, // experience
  { y: -8, bullets: [L + 196, L + 150] }, // projects
  { y: 44, bullets: [L + 176] }, // education
];
const bulletDots = [];
sections.forEach((sec, si) => {
  S(`heading-${si + 1}`, [[L, sec.y], [L + 58, sec.y]], C.ink, 3.4, 4);
  sec.bullets.forEach((end, bi) => {
    const y = sec.y + 17 + bi * 12;
    bulletDots.push({ x: L + 3, y, strokeIdx: strokes.length });
    S(`s${si + 1}-bullet-${bi + 1}`, [[L + 11, y], [end, y]], C.line, 1.9, 4);
  });
});
S('heading-skills', [[L, 84], [L + 44, 84]], C.ink, 3.4, 4);

// ---- timeline ----
const PAPER_IN = 0;
const PAPER_SETTLE = 26;
const PEN_IN_START = 12;
const WRITE_START = 28;
const HOP = 2;

let t = WRITE_START;
for (const s of strokes) {
  s.cum = measure(s.pts);
  s.t0 = t;
  s.t1 = t + s.dur;
  t = s.t1 + (s.hopAfter ?? HOP);
}
const WRITE_END = strokes[strokes.length - 1].t1;
const PEN_REST_START = WRITE_END + 2;
const PEN_REST_END = PEN_REST_START + 14;
const CHIPS_START = WRITE_END + 3;
const CHECK_START = PEN_REST_END - 4;
// The finished sheet, badge landed: what reduced-motion shows (marker below).
const FINISHED = CHECK_START + 20;
// Loop: hold on the finished sheet, then the pen lifts away and the sheet slides
// off, leaving the empty desk that frame 0 starts on, so the restart is seamless.
const HOLD_END = CHECK_START + 14 + 40;
const PEN_EXIT_START = HOLD_END;
const PEN_EXIT_END = PEN_EXIT_START + 14;
const SHEET_EXIT_START = PEN_EXIT_START + 10; // pen is nearly gone; it rides on the sheet
const SHEET_EXIT_END = SHEET_EXIT_START + 18;
const OP = SHEET_EXIT_END + 10; // a beat of empty desk before the next sheet drops in

// pen tip position per frame (paper-local), plus "lifted" amount 0..1
// Off the bottom-right of the desk with the WHOLE pen clear, not just the nib
// (the barrel points up-right, ~100px above and ~80px right of the tip).
const PEN_OFF = [340, 330];
const PEN_REST = [200, 40]; // lying beside the sheet when done
const penAt = f => {
  if (f < WRITE_START) {
    const u = travel(Math.max(0, (f - PEN_IN_START) / (WRITE_START - PEN_IN_START)));
    const a = PEN_OFF;
    const b = strokes[0].pts[0];
    // gentle arc: bow the path up-left so it does not travel in a straight line
    const mid = [(a[0] + b[0]) / 2 + 40, (a[1] + b[1]) / 2 - 30];
    const q = (p0, p1, p2, x) => (1 - x) ** 2 * p0 + 2 * (1 - x) * x * p1 + x * x * p2;
    return { p: [q(a[0], mid[0], b[0], u), q(a[1], mid[1], b[1], u)], lift: 1 - u * 0.999 };
  }
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (f >= s.t0 && f <= s.t1) {
      return { p: pointAt(s.pts, s.cum, stroke((f - s.t0) / s.dur)), lift: 0 };
    }
    const next = strokes[i + 1];
    if (next && f > s.t1 && f < next.t0) {
      const u = travel((f - s.t1) / (next.t0 - s.t1));
      const a = s.pts[s.pts.length - 1];
      const b = next.pts[0];
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], lift: Math.sin(Math.PI * u) };
    }
  }
  if (f <= PEN_REST_START) {
    const last = strokes[strokes.length - 1];
    return { p: last.pts[last.pts.length - 1], lift: 0 };
  }
  if (f <= PEN_EXIT_START) {
    const u = settleSoft(Math.min(1, (f - PEN_REST_START) / (PEN_REST_END - PEN_REST_START)));
    const a = strokes[strokes.length - 1].pts[1];
    return { p: [a[0] + (PEN_REST[0] - a[0]) * u, a[1] + (PEN_REST[1] - a[1]) * u], lift: Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.9 };
  }
  // picked up and carried off the bottom-right, the way it came in
  const u = exitAccel(Math.min(1, (f - PEN_EXIT_START) / (PEN_EXIT_END - PEN_EXIT_START)));
  return {
    p: [PEN_REST[0] + (PEN_OFF[0] - PEN_REST[0]) * u, PEN_REST[1] + (PEN_OFF[1] - PEN_REST[1]) * u],
    lift: Math.min(1, u * 3),
  };
};

// ---- background: desk ----
const grainLines = [];
for (let i = 0; i < 9; i++) {
  const y0 = 18 + i * 52 + (i % 3) * 7;
  const pts = [];
  for (let x = -20; x <= W + 20; x += 20) {
    pts.push([x, +(y0 + Math.sin(x / (90 + i * 13) + i) * (5 + (i % 4) * 2)).toFixed(2)]);
  }
  grainLines.push(group(`grain-${i}`, [poly(pts), { ...strokeStyle(C.grain, i % 2 ? 1.2 : 2.2), o: st(i % 2 ? 45 : 30) }]));
}
// knot
grainLines.push(group('knot', [ellipse(548, 356, 34, 12), { ...strokeStyle(C.grain, 1.6), o: st(45) }]));
grainLines.push(group('knot-2', [ellipse(548, 356, 18, 5), { ...strokeStyle(C.grain, 1.4), o: st(40) }]));

// ---- desk props (drawn first so they sit under the sheet) ----
const mug = [ // bottom → top; reversed below because Lottie draws the first item on top
  group('mug-shadow', [ellipse(0, 0, 108, 108), fill(C.shadow)], { p: st([7, 9]), o: st(10) }),
  group('mug-handle', [rect(52, 0, 34, 20, 10), fill(C.stone)]),
  group('mug-body', [ellipse(0, 0, 104, 104), fill(C.cream)]),
  group('mug-rim', [ellipse(0, 0, 90, 90), { ...strokeStyle(C.stone, 3) }]),
  group('coffee', [ellipse(0, 0, 80, 80), fill(C.accent800)]),
  group('crema', [ellipse(0, 0, 58, 58), { ...strokeStyle(C.accent700, 6), o: st(55) }]),
  group('shine', [ellipse(-16, -16, 22, 12), fill(C.cream)], { r: st(-35), o: st(22) }),
];
const sticky = [ // bottom → top
  group('note-shadow', [rect(0, 0, 92, 92, 3), fill(C.shadow)], { p: st([5, 7]), o: st(10) }),
  group('note-back', [rect(8, -6, 92, 92, 3), fill(C.accent300)], { r: st(8) }),
  group('note', [rect(0, 0, 92, 92, 3), fill(C.accent100)]),
  group('note-lines', [
    poly([[-30, -14], [26, -14]]),
    poly([[-30, 0], [18, 0]]),
    poly([[-30, 14], [8, 14]]),
    { ...strokeStyle(C.accent300, 3) },
  ]),
];

mug.reverse();
sticky.reverse();

// ---- assemble (Lottie: first layer in the array draws on top) ----
// Build bottom-up into `stack`, then reverse.
const stack = [];
const push = l => {
  stack.push(l);
  return l;
};

// bg
push({
  nm: 'Desk',
  shapes: [group('wood', [rect(W / 2, H / 2, W + 40, H + 40), fill(C.wood)]), ...grainLines],
});
// props
push({ nm: 'Mug', shapes: mug, ks: { p: st([58, 70]) } });
push({ nm: 'Sticky note', shapes: sticky, ks: { p: st([588, 92]), r: st(-9) } });

// paper motion (shared by sheet + shadow)
// Frame 0 and the last frame are both the empty desk (sheet fully off-canvas,
// tilt included), so the loop restarts without a cut.
const EXIT = ez(0.5, 0, 0.75, 0.3);
const paperPos = keys([
  [PAPER_IN, [PX + 70, PY - 480], ez(0.2, 0.75, 0.34, 0.94)],
  [PAPER_SETTLE - 6, [PX - 2, PY + 5], ez(0.3, 0, 0.5, 1)],
  [PAPER_SETTLE, [PX, PY]],
  [SHEET_EXIT_START, [PX, PY], EXIT],
  [SHEET_EXIT_END, [PX - 170, PY - 500]],
]);
const paperRot = keys([
  [PAPER_IN, -14, ez(0.2, 0.75, 0.34, 0.94)],
  [PAPER_SETTLE - 6, -1.6, ez(0.3, 0, 0.5, 1)],
  [PAPER_SETTLE, -2.4],
  [SHEET_EXIT_START, -2.4, EXIT],
  [SHEET_EXIT_END, -13],
]);
// shadow arrives a beat after the sheet and tightens as it lands (follow-through)
push({
  nm: 'Sheet shadow',
  shapes: [group('shadow', [rect(0, 0, PW, PH, 2), fill(C.shadow)])],
  ks: {
    p: keys([
      [PAPER_IN, [PX + 110, PY - 440], ez(0.2, 0.75, 0.34, 0.94)],
      [PAPER_SETTLE - 2, [PX + 6, PY + 9], ez(0.3, 0, 0.5, 1)],
      [PAPER_SETTLE + 4, [PX + 5, PY + 7]],
      // leaves with the sheet, fading as it lifts off the desk
      [SHEET_EXIT_START, [PX + 5, PY + 7], EXIT],
      [SHEET_EXIT_END, [PX - 150, PY - 480]],
    ]),
    r: paperRot,
    o: keys([
      [PAPER_IN, 0],
      [PAPER_SETTLE - 4, 7, ez(0.3, 0, 0.5, 1)],
      [PAPER_SETTLE + 4, 13],
      [SHEET_EXIT_START, 13, EXIT],
      [SHEET_EXIT_END, 6],
    ]),
  },
});
const sheet = push({
  nm: 'Sheet',
  shapes: [group('paper', [rect(0, 0, PW, PH, 2), fill(C.paper)])],
  ks: { p: paperPos, r: paperRot },
});

// self-drawn hairline rule under the contact row (no pen; secondary beat)
const contactEnd = strokes.find(s => s.nm === 'contact').t1;
push({
  nm: 'Rule',
  parentOf: sheet,
  shapes: [
    group('rule', [
      poly([[L, -94], [R, -94]]),
      { ty: 'tm', s: st(0), e: keys([[contactEnd - 2, 0, ez(0.2, 0.75, 0.34, 0.94)], [contactEnd + 10, 100]]), o: st(0), m: 1 },
      strokeStyle(C.rule, 1.2),
    ]),
  ],
});

// bullet dots: appear the frame the pen arrives at the line
for (const d of bulletDots) {
  const at = strokes[d.strokeIdx].t0 - 1;
  push({
    nm: `bullet-dot-${d.strokeIdx}`,
    parentOf: sheet,
    shapes: [group('dot', [ellipse(d.x, d.y, 4, 4), fill(C.inkSoft)])],
    ks: { o: holdKeys([[0, 0], [at, 100]]) },
  });
}

// ink strokes: trim end follows the exact same progress as the pen
for (const s of strokes) {
  const e = [];
  for (let f = s.t0; f <= s.t1; f++) e.push([f, +(stroke((f - s.t0) / s.dur) * 100).toFixed(3)]);
  push({
    nm: `ink-${s.nm}`,
    parentOf: sheet,
    shapes: [
      group('ink', [
        poly(s.pts),
        { ty: 'tm', s: st(0), e: keys(e), o: st(0), m: 1 },
        strokeStyle(s.color, s.width),
      ]),
    ],
  });
}

// skill chips pop in once the pen has lifted (stagger 4f, small overshoot)
const chips = [
  [L + 22, 104, 44],
  [L + 74, 104, 52],
  [L + 128, 104, 40],
  [L + 26, 124, 52],
  [L + 82, 124, 44],
];
chips.forEach(([x, y, w], i) => {
  const t0 = CHIPS_START + i * 3;
  push({
    nm: `chip-${i + 1}`,
    parentOf: sheet,
    shapes: [
      group('chip-label', [poly([[-w / 2 + 9, 0], [w / 2 - 9, 0]]), strokeStyle(C.accent300, 2.2)]),
      group('chip', [rect(0, 0, w, 15, 7.5), fill(C.accent100)]),
    ],
    ks: {
      p: st([x, y]),
      s: keys([
        [t0, [0, 0], ez(0.2, 0.75, 0.34, 0.94)],
        [t0 + 7, [108, 108], ez(0.4, 0, 0.4, 1)],
        [t0 + 11, [100, 100]],
      ]),
    },
  });
});

// "ready" badge stamps on the top-right corner: the resolution beat
push({
  nm: 'Ready badge',
  parentOf: sheet,
  shapes: [
    group('check', [
      poly([[-8, 0.5], [-2.5, 6], [8.5, -5.5]]),
      { ty: 'tm', s: st(0), e: keys([[CHECK_START + 6, 0, ez(0.2, 0.75, 0.34, 0.94)], [CHECK_START + 14, 100]]), o: st(0), m: 1 },
      strokeStyle(C.paper, 3.4),
    ]),
    group('badge-ring', [ellipse(0, 0, 40, 40), fill(C.accent)]),
  ],
  ks: {
    p: st([PW / 2 - 34, -PH / 2 + 34]),
    s: keys([
      [CHECK_START, [0, 0], ez(0.2, 0.75, 0.34, 0.94)],
      [CHECK_START + 8, [116, 116], ez(0.4, 0, 0.4, 1)],
      [CHECK_START + 13, [100, 100]],
    ]),
    r: keys([[CHECK_START, -40, ez(0, 0.65, 0.51, 0.99)], [CHECK_START + 13, 0]]),
  },
});

// ---- the pen ----
// Drawn along +x from the nib at the origin, then the group is turned so the
// barrel points up-right (a right-handed writer).
const PEN_ANGLE = -52;
const penBody = [ // top → bottom
  group('clip', [rect(108, -9.5, 54, 4, 2), fill(C.metal)]),
  group('barrel-shine', [rect(98, -3.5, 96, 2.4, 1.2), fill(C.inkSoft)]),
  group('grip-ridges', [
    poly([[26, -7], [26, 7]]),
    poly([[33, -7], [33, 7]]),
    poly([[40, -7], [40, 7]]),
    { ...strokeStyle(C.accent700, 1.4), o: st(60) },
  ]),
  group('grip', [rect(34, 0, 30, 14, 5), fill(C.accent)]),
  group('cap-end', [rect(152, 0, 16, 15, 7), fill(C.ink)]),
  group('barrel', [rect(96, 0, 110, 15, 7.5), fill(C.ink)]),
  group('nib', [poly([[0, 0], [6, -2.2], [6, 2.2]], true), fill(C.metalDark)]),
  group('cone', [poly([[1.5, 0], [19, -6.5], [19, 6.5]], true), fill(C.metal)]),
];
const penShadow = [
  group('pen-shadow', [
    rect(92, 0, 160, 15, 7.5),
    poly([[1.5, 0], [19, -6.5], [19, 6.5]], true),
    fill(C.shadow),
  ]),
];

const penP = [];
const penS = [];
const penR = [];
const shadowP = [];
const shadowO = [];
for (let f = PEN_IN_START; f <= PEN_EXIT_END; f++) {
  const { p, lift } = penAt(f);
  penP.push([f, [+p[0].toFixed(2), +p[1].toFixed(2)]]);
  const sc = 100 + lift * 5;
  penS.push([f, [+sc.toFixed(2), +sc.toFixed(2)]]);
  // tiny wrist wobble while writing; resting pen rolls flatter onto the desk
  const writing = f >= WRITE_START && f <= WRITE_END;
  let r = writing ? Math.sin(f * 0.9) * 1.6 : 0;
  if (f > PEN_REST_START) r += -18 * settleSoft(Math.min(1, (f - PEN_REST_START) / (PEN_REST_END - PEN_REST_START)));
  // picked back up: the roll unwinds as it leaves
  if (f > PEN_EXIT_START) r *= 1 - exitAccel(Math.min(1, (f - PEN_EXIT_START) / (PEN_EXIT_END - PEN_EXIT_START)));
  penR.push([f, +r.toFixed(2)]);
  shadowP.push([f, [+(4 + lift * 10).toFixed(2), +(6 + lift * 12).toFixed(2)]]);
  shadowO.push([f, +(18 - lift * 8).toFixed(2)]);
}

const penLayer = {
  nm: 'Pen',
  parentOf: sheet,
  shapes: [
    group('body', penBody, { r: st(PEN_ANGLE), s: st([84, 84]) }),
    group('shadow', penShadow, { r: st(PEN_ANGLE), s: st([84, 84]), p: keys(shadowP), o: keys(shadowO) }),
  ],
  ks: { p: keys(penP), s: keys(penS), r: keys(penR) },
  ip: PEN_IN_START,
  // Gone once it has left: it is parented to the sheet, which would otherwise
  // drag it back into frame as the sheet slides off.
  op: PEN_EXIT_END + 1,
};

// ---- emit ----
// Pen goes above everything; the rest keeps build order (bottom → top).
const ordered = [penLayer, ...stack.slice().reverse()];
// assign indexes / parents
const out = [];
const idOf = new Map();
ordered.forEach((l, i) => idOf.set(l, i + 1));
for (const l of ordered) {
  const built = {
    ddd: 0,
    ind: idOf.get(l),
    ty: 4,
    nm: l.nm,
    sr: 1,
    ks: {
      o: l.ks?.o ?? st(100),
      r: l.ks?.r ?? st(0),
      p: l.ks?.p ?? st([0, 0]),
      a: l.ks?.a ?? st([0, 0]),
      s: l.ks?.s ?? st([100, 100]),
    },
    ao: 0,
    shapes: l.shapes,
    ip: l.ip ?? 0,
    op: l.op ?? OP,
    st: 0,
    bm: 0,
  };
  if (l.parentOf) built.parent = idOf.get(l.parentOf);
  out.push(built);
}

const doc = {
  v: '5.9.0',
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: 'Resume being written',
  ddd: 0,
  assets: [],
  layers: out,
  // `finished` is the frame ResumeWritingHero holds on under reduced motion.
  markers: [
    { tm: WRITE_END, cm: 'written', dr: 0 },
    { tm: FINISHED, cm: 'finished', dr: 0 },
  ],
};

const file = process.argv[2] ?? 'public/onboarding/resume-writing.json';
writeFileSync(file, JSON.stringify(doc));
console.log(`wrote ${file}: ${out.length} layers, write ${WRITE_START}-${WRITE_END}, rest ${PEN_REST_END}, check ${CHECK_START}, finished ${FINISHED}, exit ${PEN_EXIT_START}-${SHEET_EXIT_END}, op ${OP}`);
