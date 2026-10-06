#!/usr/bin/env node
// node scripts/make-test-music.mjs [out.wav] [--bpm 100] [--seconds 60]
// Synthesizes an ORIGINAL, rights-free placeholder bed (soft minor pad + muted kick + tick) so the
// music path can be tested without a licensed track. Replace with real music in shared/music/.
import { join } from "node:path";
import { SHARED, ensureDir, parseArgs, run } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const out = args._[0] || join(ensureDir(join(SHARED, "music")), "placeholder-bed.wav");
const bpm = Number(args.bpm || 100), beat = 60 / bpm, secs = Number(args.seconds || 60);
// A–F–C–G (Am-F-C-G), one chord per bar, gentle tremolo; kick on every beat, tick on off-beats.
const bar = (beat * 4).toFixed(4);
const chord = (f1, f2, f3) => `(sin(2*PI*${f1}*t)+0.8*sin(2*PI*${f2}*t)+0.7*sin(2*PI*${f3}*t))`;
const sel = (i) => `between(mod(t,4*${bar}),${i}*${bar},${i + 1}*${bar})`;
const pad = `0.09*(0.75+0.25*sin(2*PI*t/${beat}))*(${sel(0)}*${chord(220, 261.63, 329.63)}+${sel(1)}*${chord(174.61, 220, 261.63)}+${sel(2)}*${chord(196, 261.63, 329.63)}+${sel(3)}*${chord(196, 246.94, 293.66)})`;
const kick = `0.5*sin(2*PI*(48+70*exp(-mod(t,${beat})*30))*mod(t,${beat}))*exp(-mod(t,${beat})*9)`;
const tick = `0.05*sin(2*PI*6000*t)*exp(-mod(t+${beat / 2},${beat})*60)`;
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc='${pad}+${kick}+${tick}':s=48000:d=${secs}`, "-af", "lowpass=f=7000,aecho=0.6:0.5:180:0.18,pan=stereo|c0=c0|c1=c0,loudnorm=I=-18:TP=-2", "-ar", "48000", out]);
console.log(`✓ placeholder music bed → ${out}`);
