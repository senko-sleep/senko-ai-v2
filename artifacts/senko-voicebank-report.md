# Senko designed voicebank: implementation and reference review

Senko's first authored synthetic voicebank is connected to the running app. This is a formant voice design using the third-party eSpeak NG Emscripten synthesis engine, not a neural speech model trained from scratch. It uses original parameter definitions rather than Zira audio or Miku/Teto voice samples. The UI explicitly labels it ?Senko (designed synthetic voice)?. Subjective naturalness and the final character identity still need listening feedback.

## Character and performance

The bank combines warm, bright/playful and airy/intimate layers. Neutral delivery blends them 42/32/26 percent. Five mood performances share fixed formant parameters, with limited changes to breath, voicing, pitch range and pace. Renderer v1.1.0 adds sentence-level timing, restrained question intonation and soft dynamics, using engine-supported SSML generated from escaped plain text. User-supplied markup cannot invoke audio resources or select arbitrary voices.

The source bank is `voice/senko/voicebank.json`. Local compiled assets and SHA-256 manifests are in `.data/voice/models/senko-formant-v1/`. The released design fingerprint is `805a8e69cbec2a41`. Noise and flutter can vary between waveforms: a model fingerprint is not an audio checksum. The default local engine is set to `senko`, and the engine does not silently substitute a fallback if it fails.

## References applied

Read all six supplied links, including the publicly readable Scribd text and the Rust crate source. The DEV article was retrieved through its public API after the web reader failed. Relevant findings and individual source links are recorded in `voice/senko/REFERENCE_NOTES.md`.

The implementation applies separate timbre/performance controls, punctuation cleanup, supported prosody tags, bounded processing, interruption cleanup and end-to-end outcome tests. It retains chat context but removes visual/tool-output instructions from explicit voice turns. A real test caught an LLM fallback ignoring its speaking budget; the spoken system prompt now places a stricter script budget first and leaves headroom for pauses. Overlong audio is rejected with a duration error rather than cut mid-message.

No full-duplex microphone/chat system, WebSocket audio streaming, neural voice training, or singing engine is claimed. Those are different capabilities from delivering the requested voice-message attachment.

## Verification results

- Five voicebank tests passed: trusted phrase planning/escaping, stable formant identity, real speech in five moods, duration rejection and cancellation/recovery.
- Twenty-one relevant Vitest tests passed: voice identity/policy and reply-depth behavior.
- TypeScript and ESLint passed after the final integration changes.
- Final independent ASR/signal evaluation: 30 generated samples, six sentences in five moods; aggregate word error rate 9.02%; worst case 33.33%; all signal checks passed with zero clipped samples. Evaluation uses separate Whisper base.en int8 CPU, not the voice generator. Every final evaluation case uses the same model fingerprint.
- Initial tiny.en evaluation failed, including a long recognizer hallucination. Comparing unchanged audio with the base.en recognizer identified recognition errors in that evaluator. Initial failed results, pre-phrase results and final transcripts remain local. Thresholds were not loosened. These ASR results measure limited intelligibility, not human-rated naturalness.
- The final actual HTTP acceptance run passed on localhost:3000 using engine `senko`: real 5/30/120-second-budget speech, duration/input rejection, simultaneous requests, 429/Retry-After, an actual LLM podcast reply, saved audio, owner isolation and Range retrieval. One earlier app run failed because an overlong LLM draft was correctly rejected; the prompt isolation/budget fix was then tested successfully.
- Latest actual chat audio: 15.55 seconds, 685,854 bytes, 22,050Hz mono PCM WAV. File: `.data/voice/e2e/podcast.wav`.
- Agent-browser played the latest audio; currentTime advanced, duration decoded correctly and media error was null. Pausing and seeking to seven seconds succeeded. At 390x844 the UI had no horizontal overflow; screenshot: `artifacts/senko-voicebank-mobile.png`. This is Chromium viewport testing, not a physical iPhone/Safari listening test.
- Existing usage policy remains: 5?120-second budgets (30 default), 1500 characters, one active/two waiting jobs per owner, 3 requests/minute, 20/hour, global concurrency two and overall timeout 60 seconds.

## Files added or changed during this voicebank work

- Voice source/docs: `voice/senko/{voicebank.json,profile.json,evaluation.json,MODEL_CARD.md,REFERENCE_NOTES.md,README.md}`.
- Voicebank runtime/tests/build/evaluation: `scripts/senko-voice-core.mjs`, `scripts/senko-voice.mjs`, `scripts/senko-voice.d.mts`, `scripts/senko-voice-worker.mjs`, `scripts/senko-voice-build.mjs`, `scripts/senko-voice.test.mjs`, `scripts/senko-voice-evaluate.mjs`, `scripts/senko-voice-evaluate.py`.
- App integration: `src/lib/server/voice.ts`, `src/lib/server/reply.ts`, `src/lib/server/persona.ts`, `src/lib/voice/intent.ts`, `src/components/assistant/lib.ts`, `src/app/api/tts/route.ts`.
- Configuration/test entry points: `next.config.mjs`, `package.json`, `package-lock.json`, `scripts/voice-e2e.mjs`, and local `.env.local` engine selection.

The code supports later replacement by a trained acoustic model, but the original request for a neural model trained entirely from scratch has not been fulfilled by this authored bank. No unavailable checkpoint is fabricated and no neural-training completion is reported.
