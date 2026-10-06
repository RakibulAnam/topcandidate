#!/usr/bin/env node
// One-time (idempotent) setup: populate shared/ with local-only assets that are
// reproducible from npm packages / the repo / the HyperFrames skills, check system
// deps, and pre-download the Whisper model. Safe to re-run any time.
import { copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, REPO_ROOT, SHARED, HF_BIN, ensureDir, run, runInherit, log, parseArgs } from "./lib/util.mjs";
import { WHISPER_MODEL } from "./lib/config.mjs";

const args = parseArgs(process.argv.slice(2));
const nm = join(ROOT, "node_modules");

if (!existsSync(HF_BIN)) {
  log("Installing npm deps (hyperframes, gsap, fonts)…");
  runInherit("npm", ["install"], { cwd: ROOT });
}

// 1. Fonts — brand faces from @fontsource (OFL). Bangla script needs the bengali subsets.
const fontDir = ensureDir(join(SHARED, "fonts"));
const fonts = [
  ["instrument-sans", ["latin-400-normal", "latin-500-normal", "latin-600-normal", "latin-700-normal", "latin-ext-700-normal", "latin-ext-600-normal"]],
  ["source-serif-4", ["latin-600-normal", "latin-600-italic", "latin-700-normal", "latin-700-italic"]],
  ["hind-siliguri", ["bengali-500-normal", "bengali-600-normal", "bengali-700-normal", "latin-600-normal", "latin-700-normal"]],
  ["tiro-bangla", ["bengali-400-normal", "latin-400-normal"]],
];
for (const [pkg, variants] of fonts) {
  for (const v of variants) {
    const f = `${pkg}-${v}.woff2`;
    copyFileSync(join(nm, "@fontsource", pkg, "files", f), join(fontDir, f));
  }
}
log(`fonts → shared/fonts (${readdirSync(fontDir).length} files)`);

// 2. Vendor JS — GSAP (local, so renders never touch the network).
ensureDir(join(SHARED, "vendor"));
copyFileSync(join(nm, "gsap/dist/gsap.min.js"), join(SHARED, "vendor/gsap.min.js"));
log("gsap → shared/vendor");

// 3. Brand marks — single source of truth stays in apps/web/public; we copy, never redraw.
const logoDir = ensureDir(join(SHARED, "logos"));
for (const f of ["logo-mark.svg", "favicon.svg", "og-toolkit.png", "icon-512.png"]) {
  const src = join(REPO_ROOT, "apps/web/public", f);
  if (existsSync(src)) copyFileSync(src, join(logoDir, f));
}
log("logos → shared/logos (from apps/web/public)");

// 4. Sound effects — HyperFrames' bundled Pixabay-licensed library (commercial use OK).
const sfxSrc = join(ROOT, ".claude/skills/media-use/audio/assets/sfx");
const sfxDir = ensureDir(join(SHARED, "sound-effects"));
if (existsSync(sfxSrc)) {
  for (const f of readdirSync(sfxSrc)) copyFileSync(join(sfxSrc, f), join(sfxDir, f));
  log(`sfx → shared/sound-effects (${readdirSync(sfxDir).filter((f) => f.endsWith(".mp3")).length} files)`);
} else {
  log("! HyperFrames skills not installed — run: npm run setup -- --skills");
}

for (const d of ["music", "ui", "broll", "stickers"]) ensureDir(join(SHARED, d));

// 5. HyperFrames agent skills, project-scoped (video-production/.claude/skills), not global.
if (args.skills || !existsSync(join(ROOT, ".claude/skills/hyperframes-core"))) {
  const skills = ["hyperframes", "hyperframes-core", "hyperframes-animation", "hyperframes-keyframes", "hyperframes-creative", "hyperframes-cli", "hyperframes-audio", "hyperframes-registry", "hyperframes-studio", "media-use", "talking-head-recut", "embedded-captions"];
  runInherit("npx", ["-y", "skills", "add", "heygen-com/hyperframes", "--agent", "claude-code", "--copy", "--full-depth", "--yes", ...skills.flatMap((s) => ["--skill", s])], { cwd: ROOT });
}

// 6. System deps.
const need = { ffmpeg: "brew install ffmpeg", ffprobe: "brew install ffmpeg", "whisper-cli": "brew install whisper-cpp" };
for (const [bin, hint] of Object.entries(need)) {
  const ok = run("which", [bin], { allowFail: true }).status === 0;
  log(`${ok ? "✓" : "✗"} ${bin}${ok ? "" : `  →  ${hint}`}`);
}
run(HF_BIN, ["telemetry", "disable"], { allowFail: true });

// 7. Whisper model (multilingual — Bangla/Banglish need it; *.en models can't).
if (args.model !== false) {
  const modelPath = join(process.env.HOME, ".cache/hyperframes/whisper/models", `ggml-${WHISPER_MODEL}.bin`);
  if (existsSync(modelPath)) log(`✓ whisper model ${WHISPER_MODEL}`);
  else {
    log(`Downloading whisper model ${WHISPER_MODEL} (~1.6 GB, one time)…`);
    const probe = join(SHARED, ".model-probe.wav");
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", probe]);
    runInherit(HF_BIN, ["transcribe", probe, "-d", join(SHARED, ".model-probe"), "--engine", "whisper", "--model", WHISPER_MODEL, "--json"], { allowFail: true });
  }
}

writeFileSync(join(SHARED, ".setup-done"), new Date().toISOString() + "\n");
console.log("\n✓ Setup complete. Next: npm run new -- <project-name>\n");
