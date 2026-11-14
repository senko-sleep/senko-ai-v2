# Senko Formant Voicebank v1

## Identity and method

This is an authored acoustic voicebank for eSpeak NG, not a neural model trained
from scratch. Its original parameter design is in `voicebank.json`; the existing
open-source engine supplies pronunciation rules and formant synthesis. It does
not use Zira output, a prerecorded character voicebank, or a cloned speaker.
The model label in the app is **Senko (designed synthetic voice)**.

The requested identity combines a warm base, bright playful energy and a light
airy softness. These are blended controls over one fixed set of vocal-tract
resonances. Neutral delivery mixes 42% warm, 32% bright and 26% airy. Mood changes
adjust pitch, intonation range, pace, breath and voicing while preserving the
formant definition. Five performances are provided: neutral, soft, excited,
sleepy and sassy. Unknown emotions use neutral; related mood tags map to a known
performance. Synthesis is CPU-only and needs no hosted API or GPU.

Phrase-level delivery is separate from the voice definition: text is normalized
and escaped, sentence boundaries receive short pauses, questions use restrained
pitch/pace changes, and quiet moods use softer dynamics. The model fingerprint
includes the renderer version. Breath noise and flutter can vary between renders;
the fingerprint identifies the model design, not a checksum of the audio waveform.

Miku and Teto informed the separation of recognizable character timbre from
performance controls. Their voices or recordings are not incorporated. Vocaloid
and Synthesizer V voicebanks can rely on recorded source voices and trained
systems; this formant bank is a different, deliberately synthetic approach. It
does not claim their fidelity or constitute a singing engine.

## Source, builds and reproducibility

- Source: `voice/senko/voicebank.json`.
- Compiler and rendering: `scripts/senko-voice-core.mjs`.
- Terminable execution: `scripts/senko-voice-worker.mjs`, launched by
  `scripts/senko-voice.mjs`.
- `npm run voice:bank:build` writes compiled mood definitions, a source snapshot
  and SHA-256 manifest to `.data/voice/models/senko-formant-v1/`.
- The app reads the versioned source bank; changes require regeneration/review of
  the evaluation evidence. Saved messages retain the model ID, kind and source
  fingerprint. Old fallback messages keep their original labels.
- Worker execution is bounded by the existing per-owner quotas, database leases,
  queues and 60-second deadline. Cancellation terminates the worker. Workers do
  not share mutable synth state, preventing one user's mood from leaking into
  another's message. Decoded duration and WAV validation still run before success.
- Use `SENKO_VOICE_ENGINE=senko` for this bank. It does not silently substitute
  Zira if Senko synthesis fails. `auto` now prefers Senko. Explicit `custom` and
  `windows` settings retain their previously documented behavior.

## Validation

`npm run voice:bank:test` checks stable identity across layers, real speech for
all five moods, distinct waveforms, duration enforcement and worker cancellation.

`npm run voice:bank:evaluate` renders six separate evaluation sentences in each
of five moods, then uses a separate pretrained Whisper base.en recognizer to
measure word error rate. Python needs `numpy` and `faster-whisper`. The recognizer
is a testing tool, not part of voice generation. It is downloaded locally to
`.data/voice/tools/whisper` on first evaluation. Audio, timing, signal metrics,
recognizer transcripts and scores are kept under
`.data/voice/original/evaluation/`. The evaluation sentences were not used to
train anything; no neural training occurred.

The configured checks require aggregate word error rate <=20%, no individual
case above 40%, non-silent finite audio, no clipped samples, and a measurable
voiced pitch. These are intelligibility and signal checks, not a rating of
naturalness, cuteness, uniqueness or resemblance to a person/character. They do
not replace listening feedback. Improvements must keep those distinctions clear.

## Dependencies and references

eSpeak NG and the Echogarden Emscripten port are third-party synthesis software.
The package's GPL-3.0 license and source attribution are retained in
`node_modules/@echogarden/espeak-ng-emscripten/COPYING`; source links are below.
The authored Senko parameters and integration code are separate project assets.

- [eSpeak NG voice definition reference](https://github.com/espeak-ng/espeak-ng/blob/master/docs/voices.md)
- [Echogarden eSpeak NG Emscripten source](https://github.com/echogarden-project/espeak-ng-emscripten)
- [Official Miku voicebank overview](https://www.vocaloid.com/en/products/show/v6vb_hatsune_miku_v6_c)
- [Official Teto voice database and vocal styles](https://kasaneteto.jp/synthesizerv/)
- [Faster Whisper evaluation implementation](https://github.com/SYSTRAN/faster-whisper)
