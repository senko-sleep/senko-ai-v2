# Voice implementation and verification

The root cause was an empty `.data/voice/config.json`: no modelModule and no cloud workers. The previous configuration disabled useful fallback speech. No voice recordings, checkpoints, or model weights were found locally. The app now uses installed Microsoft Zira Desktop as an explicitly identified fallback, while preserving custom-model and cloud-engine integration.

Real speech generation is working on the existing application at localhost:3000. No extra voice gateway process is required for the Windows fallback. Zira uses Windows System.Speech to generate PCM WAV; other provider audio is decoded and verified with FFmpeg. Actual voice identity is saved and shown on every audio message.

## Defaults

5?120 seconds selectable speaking budget, 30 seconds default; 1,500 characters; one concurrent job and two waiting requests per owner; 3 requests/minute and 20/hour; 60-second overall deadline; two global synthesis slots and 32 global waiting slots. Environment configuration and its hard safety bounds are documented in voice/senko/README.md. Durations are maximum budgets, not padded exact-length recordings. Linked devices share the same database-backed owner quotas. Failed and canceled attempts count. Rate and queue rejection return HTTP 429 and Retry-After. Chat synthesis errors use structured metadata because SSE response headers have already been sent.

## Actual test results

- 27 relevant Vitest tests passed (voice identity, persistent minute/hour quota checks, bounded queues, cancellation, timeout, malformed audio, exact 120-second decoded boundary, chat layout and reply depth).
- 4 isolated gateway tests passed. These use mock transport audio and are not proof of speech generation.
- TypeScript passed with `--noEmit --incremental false`. An earlier redundant run exhausted machine memory with both servers/browser open; the final run passed after closing the isolated test server.
- ESLint passed for the modified runtime, voice API, voice controls, settings, and chat integration files. A stale duration dependency warning was found and corrected before completion.
- The final real HTTP acceptance script passed against localhost:3000 using the app's normal custom-first configuration and installed fallback. It checked real speech at 5/30/120-second budgets, duration 121 rejection (400), excessive text rejection (413), malformed duration rejection (400), simultaneous requests (three 200s and one 429 with Retry-After), real LLM-generated podcast dialogue, saved audio retrieval, owner isolation (404), and byte seeking (206).
- A real aborted HTTP generation returned client AbortError; an immediate retry returned valid audio. No senko-voice temporary directories remained afterward.
- Restarted the isolated app instance: the saved attachment still returned 206 and new custom-first synthesis returned real fallback audio.
- Agent-browser verified play, pause, seeking to 10 seconds, duration display, ready/playing/paused states and successful playback at desktop and 390px mobile widths. Audio currentTime advanced and HTMLMediaElement.error was null. No mobile horizontal overflow was present. This is Chromium viewport testing, not physical iPhone/Safari testing or a human listening review.
- Used the full chat UI to submit the podcast request with the 30-second selection. It produced a second real 22.52-second audio attachment, played successfully, and remained playable after browser refresh. Screenshots are in artifacts/voice-chat-desktop.png, artifacts/voice-desktop.png and artifacts/voice-mobile.png.

Final real HTTP evidence (decoded PCM WAV, mono 22,050Hz, 16-bit):

| Test | Actual seconds | Bytes |
| --- | ---: | ---: |
| 5-second budget, real Windows speech | 4.988571428571428 | 220042 |
| 30-second budget, real Windows speech | 25.944625850340135 | 1144204 |
| 120-second budget, real Windows speech | 89.60267573696144 | 3951524 |
| real chat podcast and stored audio | 25.90544217687075 | 1142476 |

Audio and machine-readable results: `.data/voice/e2e/{5s.wav,30s.wav,120s.wav,podcast.wav,results.json}`. The final saved podcast sample is a different real generation from the earlier 27.68-second sample used during browser testing.

## Modified files for this implementation

- Runtime and decoding: `scripts/windows-voice.ps1`, `scripts/windows-voice.mjs`, `src/lib/server/voice.ts`, `src/lib/server/voice-audio.ts`, `src/lib/server/voice-policy.ts`.
- Storage, identity and chat integration: `src/lib/server/db.ts`, `src/lib/server/identity.ts`, `src/lib/server/chats.ts`, `src/lib/server/reply.ts`, `src/lib/voice/intent.ts`.
- API: `src/app/api/tts/route.ts`, `src/app/api/chats/[id]/messages/route.ts`.
- UI: `src/components/assistant/voice-message.tsx`, `src/components/assistant/message-bubble.tsx`, `src/components/assistant/composer.tsx`, `src/components/assistant/assistant-app.tsx`, `src/components/assistant/lib.ts`, `src/components/sidebar/settings-panel.tsx`, `src/lib/voice-synth.ts`, `src/lib/audio-manager.ts`.
- Tests: `scripts/voice-e2e.mjs`, `src/__tests__/voice.test.ts`, `src/__tests__/voice-policy.test.ts`.
- Dependency/configuration/docs: `package.json`, `package-lock.json`, `next.config.mjs`, `.gitignore`, `voice/senko/README.md`.

Earlier gateway/setup files remain available as optional infrastructure. Unrelated pre-existing workspace changes were preserved. No deployment was performed.

## Remaining limitations

Senko's original trained voice is still unavailable; Zira is a generic fallback and is always labeled as such. Windows System.Speech is supported by the existing machine, not Linux/cloud deployment environments. Those environments require a working hosted/custom runtime or provider credentials. No original-model training or cloud GPU cluster deployment is claimed. The configured 120-second budget produced 89.60 seconds for the supplied test text; the exact 120-second boundary was verified separately using a decoded PCM validation fixture, not represented as real generated speech.

Microsoft's System.Speech WAV output contract: https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile?view=netframework-4.8.1
