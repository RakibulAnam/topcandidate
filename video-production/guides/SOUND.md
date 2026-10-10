# Sound design

Hierarchy: **1. voice · 2. meaningful SFX · 3. music.** Voice must always be intelligible.

## Voice

Ingest makes the proxy voice track: 70 Hz high-pass + loudness-normalized to −16 LUFS
(`--denoise` adds moderate FFT denoise, ≈8 dB off AC/room hiss with speech level unchanged; `--level` adds
gentle 3:1 compression + tighter loudnorm LRA for takes whose phrases swing in volume. "Stabilize the
audio" = `--denoise --level`. `--repair` = gentle voice repair for a muffled lav (85 Hz HPF, light denoise,
−2.5 dB @250 Hz, +3 dB @3 kHz, mild de-ess, slow 2:1 comp). **Never add a gate/expander or heavy denoise to
voice** — tried 2026-10-08: it chopped soft syllables and the owner heard it as "really bad".) `--rnnoise` (+`--repair`) swaps the FFT denoise for RNNoise
(speech-trained, model `bd` at 85 % wet): room noise ≈25 dB under the voice instead of ≈13 dB, tone intact —
use it when the owner asks for "noise cancellation". The final render is normalized to **−14 LUFS, −1 dBTP**.

## SFX (`shared/sound-effects/`, Pixabay license — commercial use OK)

whoosh · whoosh-short · whoosh-cinematic · pop · click · click-soft · key-press · typing ·
ping · chime · notification · sparkle · error · riser · impact-bass-1/2 · glitch-1/2/3
(`manifest.json` there describes each).

- Attach to an overlay with `"sfx": true` (component's suggestion) or a name; standalone in `sfx[]`;
  on an emphasis with `{ "text": "…", "sfx": "pop" }`; on a cut with segment `"sfx"`.
- Every SFX is capped at 1.5 s with a fade-out (override with `"dur"`); long library files (riser 10 s,
  glitch-2 3.5 s, whoosh-cinematic 5.5 s) read as static/noise if they ring on. glitch-2 is very hot — avoid.
- Volume 0.25–0.45. Use for **hits that mean something**: a card landing, a stamp, a number, the CTA.
  Not on every caption. If you can't say why a sound is there, delete it.
- Avoid stacking two SFX within ~0.3 s.

## Music

- Not automatic. Use music when the piece is montage-y, product-led, or needs energy under a
  calm speaker. Skip it for raw, confessional, or argumentative talking heads.
- Files: `shared/music/` or the project's `assets/` (licensed tracks only; `npm run test-music`
  makes an original placeholder). Build loops/trims/fades it into `composition/media/music-bed.wav`.
- Levels: `volume` (between/after speech) ≈ 0.08–0.14, `duck` (under speech) ≈ 0.03–0.05.
  Ducking is automatic from word timings (volume lane, 0.25 s ramps).
- Match tempo to cut pace; prefer tracks with no vocals.

## Checking a mix without ears

```bash
ffmpeg -i previews/preview-01.mp4 -vn -af "asetnsamples=24000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 | grep -oE "RMS_level=-?[0-9.]+"
```
Half-second RMS: speech ≈ −16…−22 dB throughout; no −70 holes mid-video (dropped audio);
CTA/music swells shouldn't exceed speech by more than ~3 dB.
