// Shared helpers for the video-production scripts. Node built-ins only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REPO_ROOT = resolve(ROOT, "..");
export const SHARED = join(ROOT, "shared");
export const PROJECTS = join(ROOT, "projects");
export const HF_BIN = join(ROOT, "node_modules/.bin/hyperframes");

export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts"]);
export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);

export const PROJECT_DIRS = ["input", "assets", "working", "captions", "audio", "composition", "previews", "output", "notes"];

// Child env: keep everything local — no telemetry, and never let `snapshot --describe`
// silently ship frames to Gemini because a key happens to be exported.
export function localEnv(extra = {}) {
  const env = { ...process.env, DO_NOT_TRACK: "1", HYPERFRAMES_NO_TELEMETRY: "1", PRODUCER_BROWSER_GPU_MODE: process.env.PRODUCER_BROWSER_GPU_MODE ?? "hardware", ...extra };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  return env;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, env: localEnv(), ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    const tail = (r.stderr || r.stdout || "").split("\n").slice(-25).join("\n");
    throw new Error(`${cmd} ${args.join(" ")}\n→ exit ${r.status}\n${tail}`);
  }
  return r;
}

export function runInherit(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: localEnv(), ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(" ")} → exit ${r.status}`);
  return r;
}

export const readJSON = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
export function writeJSON(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}
export const ensureDir = (p) => (mkdirSync(p, { recursive: true }), p);

export function projectDir(name) {
  if (!name) die("Missing project name. Usage: npm run <script> -- <project> [flags]");
  const p = name.includes("/") ? resolve(name) : join(PROJECTS, name);
  if (!existsSync(p)) die(`Project not found: ${p}\nCreate it with: npm run new -- ${name}`);
  return p;
}

export function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile() && (!exts || exts.has(extname(f).toLowerCase())))
    .sort();
}

// Flags that take a value (`--at 1,2` or `--at=1,2`). Every other flag is boolean, so a mode flag
// injected by an npm script (`render.mjs --snapshot <project>`) never swallows the project name.
const VALUE_FLAGS = new Set(["at", "lang", "fps", "model", "primary", "port", "from", "template", "brief", "url", "name", "width", "height", "bpm", "seconds"]);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--no-")) out[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (VALUE_FLAGS.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

export const log = (msg) => console.log(`• ${msg}`);
export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function ffprobe(file) {
  const r = run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  return JSON.parse(r.stdout);
}

export function fracToNum(f) {
  if (!f || f === "0/0") return 0;
  const [a, b] = String(f).split("/").map(Number);
  return b ? a / b : a;
}

export const escapeHTML = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// `*word*` → accent emphasis, `**word**` → strong marker. Everything else escaped.
export function richText(s) {
  return escapeHTML(s)
    .replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>')
    .replace(/\*(.+?)\*/g, '<em class="acc">$1</em>');
}
