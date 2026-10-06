#!/usr/bin/env node
// npm run check    -- <project>                      build + HyperFrames lint/layout/contrast check
// npm run snapshot -- <project> [--at 1,4.5,9]       build + PNG frames → previews/snapshots/ (fast visual QA)
// npm run preview  -- <project>                      build + draft MP4 → previews/preview-NN.mp4
// npm run render   -- <project> [--fps 60]           build + delivery MP4 → output/final.mp4 (H.264/AAC, −14 LUFS, faststart)
// Variant flags (forwarded to build, and named in the output): --no-music --no-captions --no-sfx --no-overlays
//   e.g. npm run render -- my-video --no-music   →  output/final-no-music.mp4
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { HF_BIN, projectDir, readJSON, writeJSON, ensureDir, parseArgs, run, runInherit, ffprobe, log, die } from "./lib/util.mjs";
import { RENDER, FORMAT } from "./lib/config.mjs";

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const P = projectDir(args._[0]);
const C = join(P, "composition");
const variantFlags = ["music", "captions", "sfx", "overlays"].filter((k) => args[k] === false);
const suffix = variantFlags.length ? "-no-" + variantFlags.join("-no-") : "";

// 1. Build (always — cheap, and guarantees the composition matches edit.json).
runInherit("node", [join(import.meta.dirname, "build.mjs"), P, ...variantFlags.map((k) => `--no-${k}`)]);

const pj = readJSON(join(P, "project.json"), {});
const record = (kind, file, extra = {}) => {
  pj.renders = [...(pj.renders || []), { kind, file, at: new Date().toISOString(), ...extra }].slice(-30);
  writeJSON(join(P, "project.json"), pj);
};

if (args["check-only"]) {
  // Captions intentionally live in the lower-middle band; tell `check` where that is.
  runInherit(HF_BIN, ["check", C, "--caption-zone", "x0=0.05;y0=0.55;x1=0.87;y1=0.8;severity=warning"], { allowFail: true });
  process.exit(0);
}

if (args.snapshot) {
  const out = ensureDir(join(P, "previews/snapshots"));
  for (const f of readdirSync(out)) rmSync(join(out, f));
  const tl = readJSON(join(P, "working/timeline.json"), { total: 10 });
  const at = typeof args.at === "string" ? args.at : Array.from({ length: 8 }, (_, i) => ((tl.total * (i + 0.5)) / 8).toFixed(2)).join(",");
  runInherit(HF_BIN, ["snapshot", C, "--at", at, "-o", out]);
  log(`snapshots → ${out}`);
  process.exit(0);
}

if (args.preview) {
  const dir = ensureDir(join(P, "previews"));
  const n = readdirSync(dir).filter((f) => /^preview-\d+.*\.mp4$/.test(f)).length + 1;
  const out = join(dir, `preview-${String(n).padStart(2, "0")}${suffix}.mp4`);
  const t0 = Date.now();
  runInherit(HF_BIN, ["render", C, "--quality", RENDER.preview.quality, "--fps", String(RENDER.preview.fps), "--output", out, "--quiet"]);
  record("preview", `previews/${basename(out)}`, { seconds: Math.round((Date.now() - t0) / 1000) });
  if (pj.status !== "final") writeJSON(join(P, "project.json"), { ...pj, status: "previewed" });
  console.log(`\n✓ Preview: ${out}\n`);
  process.exit(0);
}

if (args.final) {
  const edit = readJSON(join(P, "edit.json"), {});
  const fps = String(args.fps || edit.format?.fps || FORMAT.fps);
  const tmp = join(P, "working/render-raw.mp4");
  const t0 = Date.now();
  runInherit(HF_BIN, ["render", C, "--quality", RENDER.final.quality, "--fps", fps, "--output", tmp, "--quiet"]);

  // Social delivery: H.264 video untouched, audio loudness-normalized (two-pass) to −14 LUFS, faststart.
  const { I, TP, LRA } = RENDER.loudness;
  const m = run("ffmpeg", ["-hide_banner", "-i", tmp, "-af", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, "-f", "null", "-"]).stderr;
  const j = JSON.parse(m.slice(m.lastIndexOf("{"), m.lastIndexOf("}") + 1));
  const outDir = ensureDir(join(P, "output"));
  const out = join(outDir, `final${suffix}.mp4`);
  const af = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  rmSync(tmp);

  const pr = ffprobe(out);
  const v = pr.streams.find((s) => s.codec_type === "video"), a = pr.streams.find((s) => s.codec_type === "audio");
  const summary = { codec: v.codec_name, width: v.width, height: v.height, fps: v.r_frame_rate, audio: a ? a.codec_name : "none", duration: Number(pr.format.duration).toFixed(2), sizeMB: (Number(pr.format.size) / 1e6).toFixed(1), loudnessIn: j.input_i };
  if (v.codec_name !== "h264" || (a && a.codec_name !== "aac")) log(`! unexpected codecs: ${JSON.stringify(summary)}`);
  if (existsSync(join(P, "captions/captions.srt"))) copyFileSync(join(P, "captions/captions.srt"), join(outDir, `final${suffix}.srt`));
  record("final", `output/${basename(out)}`, { ...summary, seconds: Math.round((Date.now() - t0) / 1000) });
  writeJSON(join(P, "project.json"), { ...readJSON(join(P, "project.json")), status: "final" });
  console.log(`\n✓ Final: ${out}\n  ${summary.width}×${summary.height} ${summary.codec} @ ${summary.fps} · ${summary.audio} · ${summary.duration}s · ${summary.sizeMB} MB\n`);
  process.exit(0);
}

die("Pass one of --check-only | --snapshot | --preview | --final (use the npm scripts).");
