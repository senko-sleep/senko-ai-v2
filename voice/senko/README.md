# Voice messages

## Current natural hybrid voice

The active local engine is now `senko-hybrid`: pretrained Kokoro-82M neural speech, a fixed authored style blend, and a restrained synthetic texture. It is labeled **Senko (neural hybrid voice)**. The earlier formant bank is available for comparison, but is not the active default. No from-scratch neural training or Qwen inference is claimed.

Run `npm run voice:neural:setup` for repeatable isolated installation, pinned public model downloads, a real inference check, and engine selection. Models and the Python environment remain local under `.data/voice/` across restarts. This laptop uses one global inference slot. See [NEURAL_RESEARCH.md](NEURAL_RESEARCH.md) for the supplied paper review, hardware decision, exact provenance and tests.

## Earlier formant voicebank

The earlier `SENKO_VOICE_ENGINE=senko` option is: an authored formant voicebank combining warm, bright and airy traits. It generates speech locally on Node using the eSpeak NG Emscripten engine and is labeled **Senko (designed synthetic voice)**. It is not a neural model trained from scratch. See [MODEL_CARD.md](MODEL_CARD.md) for source, mood blending, provenance, local model builds and independent intelligibility checks. `auto` prefers the installed neural hybrid before this earlier bank. Zira remains an explicitly selectable fallback engine, not the default Senko identity.

The sections below describe the existing transport, limits and optional fallback engines.

## Working engine discovery

On Windows the app synthesizes speech through installed English System.Speech voices (preferring an enabled female voice). This machine has Microsoft Zira Desktop and Microsoft David Desktop. Zira is explicitly labeled **fallback voice**; it is not Senko's original trained voice. No checkpoints or recordings were found in the repository or local voice storage.

The fallback runs inside the app's request lifecycle, without requiring a separate gateway process. It therefore survives app restarts. It uses private temporary input/output files, kills the synthesis subprocess on cancellation/timeout, and deletes temporary files afterward. Speech is returned as PCM WAV for desktop and mobile playback. Provider MP3 and other supported encodings are fully decoded with the bundled FFmpeg binary before storage.

`SENKO_VOICE_ENGINE=custom` tries the custom endpoint first, then the configured fallback. `auto` discovers custom, Windows and configured ElevenLabs engines. Set `SENKO_VOICE_FALLBACK=none` for strict custom-only operation; this intentionally fails if the original model is absent. `SENKO_VOICE_WINDOWS=0` disables Windows discovery. Linux/cloud deployments need a configured custom runtime or ElevenLabs credentials; Windows speech cannot run on Linux.

## Limits

All direct `/api/tts` and chat voice synthesis use the same owner identity, PostgreSQL rate history, expiring database execution leases, bounded queues, and cancellation deadline. Quotas are shared across linked devices and server processes. Requests remain counted after failure or cancellation. Queue tickets expire after crashes; active leases are released in finally blocks. The gateway is a trusted internal model transport, not a public user API; expose only authenticated application routes to clients.

Environment settings (defaults):

| Setting prefix: `SENKO_VOICE_` | Default |
| --- | --- |
| MIN_SECONDS | 5 |
| DEFAULT_SECONDS | 30 |
| MAX_SECONDS | 120 |
| MAX_CHARS | 1500 |
| PER_USER_CONCURRENT | 1 |
| PER_MINUTE | 3 |
| PER_HOUR | 20 |
| TIMEOUT_MS | 60000 |
| QUEUE_PER_USER | 2 |
| GLOBAL_CONCURRENT | 2 |
| GLOBAL_QUEUE | 32 |
| ENGINE_TIMEOUT_MS (custom attempt) | 15000 |

Duration selections are maximum speaking budgets, not padded exact-length recordings. Shorter text naturally produces shorter audio. Input duration, raw text length, estimated speech time, decoded audio duration, and audio structure are validated. The app never truncates speech to fit a budget. The maximum configurable duration/text/timeout are capped at 120 seconds, 1500 characters, and 60000 ms respectively; lower values can be configured. Invalid configuration falls back to safe defaults. A generation shares one total deadline across queuing, synthesis, failover, and decoding. An engine timeout leaves time for a local fallback. Provider 429 responses are not retried.

`GET /api/tts` returns the configured limits. `POST /api/tts` accepts `{text, durationSeconds?}` and returns actual audio with X-Audio-Duration, X-Voice-Engine and X-Voice-Name headers. Errors include a machine-readable code. Rate/queue responses use HTTP 429 and Retry-After. Chat uses streamed generation progress and persisted voiceError metadata because HTTP headers have already been sent by the time synthesis finishes. Voice-message audio is owner-scoped in the existing uploads table and supports byte ranges for seeking. Saved attachments remain available after refresh/restart; temporary synthesis files do not persist.

## Original model and optional cloud gateway

Assets can be kept in `.data/voice/{recordings,datasets,models}`. All are excluded from Git; back them up separately. `npm run voice:setup` creates these folders and preserves existing settings. `SENKO_VOICE_URL` is the custom synthesis endpoint, with optional bearer `SENKO_VOICE_TOKEN`. Its JSON contract contains text, voice (senko-v1), mood, personality, profile, requested durationSeconds, format and speed. Return raw audio and an audio Content-Type. The app verifies the actual audio rather than trusting the provider's duration header.

The optional `npm run voice:serve` gateway supports local `modelModule` adapters or cloud `workers` in `.data/voice/config.json`. Local modules export `synthesize(input, {signal})`, returning `{audio: Buffer, mime, seconds?}`. All cloud workers must serve the same trained voice. Round-robin routing increases capacity but does not remove GPU limits or provider quotas. A model adapter must honor cancellation; a gateway cannot forcibly interrupt arbitrary in-process GPU code. Never expose this internal gateway to untrusted users; public binding requires a bearer token and a trusted HTTPS ingress.

No neural training is claimed. The authored Senko bank now provides the default synthetic voice; Windows speech remains an explicitly labeled alternative.

## Verification

- `npm run voice:test`: isolated gateway transport tests (mock audio, not speech proof).
- `npx vitest run src/__tests__/voice.test.ts src/__tests__/voice-policy.test.ts`: quota, queue, timeout, validation and identity tests.
- `node scripts/voice-e2e.mjs`: real app HTTP requests, Windows speech, decoded WAV inspection, chat LLM to stored attachment, owner access and Range checks. Defaults to localhost:3012; override VOICE_TEST_URL. Saves evidence under `.data/voice/e2e` and an ignored renderer acceptance fixture. Requires a running app with Windows fallback and a working chat provider. Generated PCM fixtures used in isolated validation tests are not evidence of speech synthesis.
