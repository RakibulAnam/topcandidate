#!/usr/bin/env node
// node scripts/make-test-footage.mjs <out.mp4>
// Synthesizes a stand-in "raw talking-head take" for pipeline testing when no real footage exists:
// macOS TTS (Banglish, en_IN voice) with deliberate flaws — dead air, a false start, an "umm",
// long pauses — over a placeholder speaker silhouette. NOT for publishing.
import { join, dirname } from "node:path";
import { run, ensureDir, die } from "./lib/util.mjs";

const out = process.argv[2];
if (!out) die("Usage: node scripts/make-test-footage.mjs <out.mp4>");
const tmp = ensureDir(join(dirname(out), ".synth"));

const script = [
  "[[slnc 1300]] Apni ekta CV diye. [[slnc 900]] umm. [[slnc 700]]",
  "Apni ekta CV diye, bish ta job e apply kortesen, ar bhabtesen, keno kono call ashe na? [[slnc 1600]]",
  "Apnar CV kharap na. Problem hocche, apni shob job er jonno same CV use kortesen. [[slnc 500]]",
  "Prottek ta job, alada jinish chay. Recruiter dekhei bujhe jay, eta generic. [[slnc 1400]]",
  "Tai prottek job er jonno, resume, cover letter, recruiter email, shob tailor kora lagbe. [[slnc 600]]",
  "Top Candidate e job post ta paste korun. Ek minute er moddhe, puro application kit ready. [[slnc 500]]",
  "Prothom resume free. [[slnc 1200]]",
].join(" ");

run("say", ["-v", "Rishi", "-r", "168", "-o", join(tmp, "voice.aiff"), script]);
// Room tone so silences aren't digital zero (like a real phone mic).
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", join(tmp, "voice.aiff"), "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.004:seed=7", "-filter_complex", "[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0[v];[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0[n];[v][n]amix=inputs=2:duration=first:normalize=0[a]", "-map", "[a]", "-c:a", "pcm_s16le", join(tmp, "voice.wav")]);

// Placeholder speaker: warm wall, silhouette (head + shoulders), voice-reactive bar as "mouth".
const geq = "r='if(lt(hypot(X-540,Y-720),190),58,if(lt(hypot((X-540)/1.55,(Y-1460)/1.0),420),40,196-Y/40))':g='if(lt(hypot(X-540,Y-720),190),46,if(lt(hypot((X-540)/1.55,(Y-1460)/1.0),420),52,188-Y/42))':b='if(lt(hypot(X-540,Y-720),190),44,if(lt(hypot((X-540)/1.55,(Y-1460)/1.0),420),70,176-Y/45))'";
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=1", "-vf", `geq=${geq},drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial Bold.ttf':text='SYNTHETIC TEST TAKE':x=(w-tw)/2:y=260:fontsize=44:fontcolor=white@0.55`, "-frames:v", "1", join(tmp, "bg.png")]);
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", join(tmp, "bg.png"), "-i", join(tmp, "voice.wav"),
  "-filter_complex", "[1:a]showvolume=f=0.5:w=220:h=26:o=h:ds=lin:dm=0:p=0.9:v=0:t=0:b=0,format=rgba[m];[0:v][m]overlay=x=430:y=800:shortest=1,noise=alls=5:allf=t,format=yuv420p[v]",
  "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-shortest", out]);
console.log(`✓ synthetic raw take → ${out}`);
