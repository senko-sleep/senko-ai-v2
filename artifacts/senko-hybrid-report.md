# Senko neural hybrid voice — local validation

Senko's active local voice uses Kokoro-82M neural synthesis, a fixed 50/30/20
af_heart/af_bella/af_nicole style blend, and a restrained parallel synthetic
texture. Delivery settings vary pace, gain and texture while retaining the blend.
This is a pretrained voice candidate, not a neural model trained from scratch.

## Working path

- Pinned Python environment, model assets and asset hashes stored under `.data/voice/`.
- `SENKO_VOICE_ENGINE=senko-hybrid` selected locally after real synthesis succeeded.
- Chat reply → neural inference → saved attachment → authenticated audio playback.
- Explicit selection reports missing models accurately instead of switching speakers.

## Verified on this machine

- Final FP32 corpus: 30 samples, five delivery settings, 0% word error rate with
  faster-whisper base.en; all clipping, RMS and pitch-presence checks passed.
  This is a small intelligibility benchmark, not a human naturalness score.
- Real app: 5-second budget produced 4.117 seconds; 30-second budget produced
  22.747 seconds. A real LLM podcast reply produced 15.541 seconds.
- Browser: playback advanced, no media error, seeking to seven seconds succeeded;
  390 × 844 viewport had no horizontal overflow.
- Input validation, owner isolation, HTTP Range playback, queue admission and
  persistent rate limiting passed. Excess requests returned HTTP 429.
- TypeScript checking, focused ESLint and the 21 related application tests passed.

Audio: [Podcast reply](../.data/voice/e2e/podcast.wav).
Mobile screenshot: [Player](senko-hybrid-mobile.png).
Machine-readable results: `.data/voice/e2e/results.json` and
`.data/voice/hybrid/evaluation/results.json` (local, ignored files).

## Voice-request regression follow-up

The comic detector no longer treats `sexuality` as an explicit-content prefix.
Spoken drafts are now checked before publication for false audio-capability
disclaimers, excessive length and visual formatting. One bounded rewrite is
allowed; an invalid rewrite produces an explicit error instead of a text-only
substitute. Valid replies proceed to actual synthesis and attachment storage.

The latest real app regression used the user's coming-out bedtime-story request
with an obsolete "I can't send audio" assistant message seeded into history. It
produced a 16.864-second neural attachment, with no unvalidated text deltas.
The sample is `.data/voice/story/bedtime.wav`; its transcript and metadata are in
`.data/voice/story/result.json`. All 42 focused tests and focused ESLint passed.

## Remaining limits

The full 120-second-budget app case returned HTTP 504 at the existing 60-second
deadline. Smaller batches and CPU FP32 did not resolve it. A separately adapted
DirectML graph generated audio but was slower in the measured short test and is
not active. No partial recording or increased timeout was used to hide the failure.

No Qwen, MOSS, F5 or EmoCtrl model was trained or run. Their papers informed the
design; this implementation does not reproduce learned emotional embeddings,
laughter or crying. Original speaker training and reliable long-form latency
remain unfinished. Sharding alone does not provide unlimited compute or remove
capacity limits.

See [research and setup notes](../voice/senko/NEURAL_RESEARCH.md) for primary
sources, reproducible commands, asset provenance and performance measurements.
