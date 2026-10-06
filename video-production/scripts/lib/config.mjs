// Studio-wide defaults. Brand values mirror apps/web/src/index.css (@theme) — if the
// product palette changes there, update BRAND below and shared/brand/tokens.css together.

// Multilingual model: Bangla + Banglish + English code-switching. `*.en` models
// can't hear Bangla. large-v3-turbo ≈ large-v3 accuracy at ~4× the speed.
export const WHISPER_MODEL = process.env.TC_WHISPER_MODEL || "large-v3-turbo";

export const FORMAT = { width: 1080, height: 1920, fps: 30 };

// Pixels that platform UI covers on a 1080×1920 Reel/TikTok/Short. Captions and key
// graphics stay inside; full-bleed backgrounds may ignore it.
export const SAFE = { top: 220, bottom: 400, left: 60, right: 140 };

export const BRAND = {
  ink: "#0F1B2D", ink800: "#09121F", ink600: "#22324B", ink400: "#5A6A85", ink100: "#D6DCE5",
  orange: "#E8743B", orange600: "#C95D27", orange700: "#9C461D", orange100: "#FADCCB",
  stone: "#FAFAF7", stone100: "#F2F1EB", stone200: "#E5E2D8", stone500: "#6B6759",
  ctaSurface: "#17243A", ctaBorder: "#2A3850", cream: "#F4F1EA",
  chips: {
    resume: { fg: "#E8A83E", bg: "rgba(232,150,15,.14)", bd: "rgba(232,150,15,.32)" },
    cover: { fg: "#E89A7E", bg: "rgba(224,120,86,.14)", bd: "rgba(224,120,86,.32)" },
    email: { fg: "#8CC9A0", bg: "rgba(95,168,118,.14)", bd: "rgba(95,168,118,.32)" },
    linkedin: { fg: "#9DB8DF", bg: "rgba(107,140,190,.16)", bd: "rgba(107,140,190,.34)" },
    interview: { fg: "#B7A3D8", bg: "rgba(150,120,190,.16)", bd: "rgba(150,120,190,.34)" },
  },
  url: "topcandidatebd.com",
};

// Analysis heuristics (ingest). Banglish fillers included — candidates only; the
// editor (Claude) decides what actually goes.
export const FILLERS = ["um", "umm", "uh", "uhh", "uhm", "erm", "eh", "ehh", "ah", "aah", "hmm", "mm", "arm", "aum", "mane", "matlab", "ashole", "asole", "toh", "to", "accha", "acha", "basically", "actually", "like", "you know", "so"];
export const HARD_FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "eh", "ehh", "ah", "aah", "hmm", "mm"]);
export const PAUSE = { tighten: 0.45, long: 0.9, padIn: 0.08, padOut: 0.14 };

// Render presets.
export const RENDER = {
  preview: { quality: "draft", fps: 30 },
  final: { quality: "delivery" },
  loudness: { I: -14, TP: -1.0, LRA: 11 }, // social-platform loudness target for the final mix
};
