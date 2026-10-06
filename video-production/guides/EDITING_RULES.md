# Editing rules — how to cut

Hierarchy: **story → retention → clarity → pacing → visual interest → branding.**
Every cut, overlay and sound must earn its place. When in doubt, leave it out.

## Reading the footage

- `working/analysis.md` gives: transcript with source times, long pauses, filler candidates,
  likely retakes (a phrase repeated soon after = earlier attempt is a false start; keep the
  later, usually better, take), suggested keep-segments (speech runs, pauses ≥ 0.45 s removed,
  boundaries snapped into detected silence).
- Treat the suggestions as a first draft, not the edit. Judge each sentence: does it move the story?
- `working/contact-sheet.jpg`: framing, headroom, lighting, whether the speaker moves.

## Structure first

1. Find the **spine**: the one idea the video sells. Write it in BRIEF.md as one sentence.
2. Find the **best hook line** anywhere in the take — it doesn't have to be the first thing said.
   Reorder segments if the strongest line is later (segments play in array order).
3. Pick a template (`templates/`) only as a checklist. Footage decides the structure.
4. Cut everything that doesn't serve the spine: warm-up intros ("Hi guys, aaj ami…"), throat
   clearing, tangents, repeated explanations, weak second examples, "like and subscribe" mid-video.

## Cutting talking heads

- Remove: dead air, false starts, repeated sentences, long pauses, obvious stumbles.
- Pauses: tighten to ~0.15–0.3 s between sentences; keep a ~0.4–0.6 s beat *before* a punchline
  or reveal — silence is emphasis.
- Fillers: cut hard fillers (um/uh/eh) when isolated. Banglish discourse words ("mane", "toh",
  "accha", "actually") often carry rhythm and personality — keep unless they're a tic.
- Never cut inside a word. Segment `in` ≈ word start − 0.06…0.1 s, `out` ≈ word end + 0.1…0.15 s;
  the analysis already snaps to silence — keep its boundaries unless you have a reason.
- Jump cuts on a single static shot: `camera.autoPunch` alternates 1.0 / 1.08 zoom so cuts read
  intentional. Turn it off for "less edited".
- Don't edit hyperactively: most segments should be ≥ 2 s. A cut every 0.5 s feels anxious.
- Target length: hook lands < 3 s; 25–45 s for Reels unless the brief says otherwise.
- Keep breaths that make the person sound human; remove ones that sound like gasps after cuts.

## First 3 seconds

Start on the line, not before it (no lead-in). Options, strongest first:
contrarian claim ("Apnar CV kharap na.") · direct question to the viewer · a number/stake
(`counter`) · a visual pattern-break (`title` card, `resume` with stamp). Add at most **one**
graphic + one camera punch in the hook. Captions must be visible from frame 1.

## Visual beats

- An overlay must *show* what's being said (job post when talking about job posts, the toolkit
  when listing deliverables) or *add* a fact (price, steps). Decoration doesn't count.
- 1 overlay per sentence at most; leave the speaker's face visible most of the time.
- Product UI appears when the product is mentioned — after the problem lands, not before.
- Ending: spoken CTA or `outro: cta` card (2.5–3 s). Don't do both at full length.

## After building

Snapshot hook, each overlay, each emphasis, and the CTA. Watch the preview once fully with sound
before calling it done. Check: any clipped word? any caption hidden behind a card? orange overuse?
