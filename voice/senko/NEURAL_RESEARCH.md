# Natural human–synthetic voice direction

The target is natural conversational speech with a restrained synthetic character.
The earlier formant bank is retained for comparison, but is not the new default.
The active local candidate uses pretrained Kokoro-82M neural weights, an authored
fixed style blend, and a quiet parallel texture layer. It is not a from-scratch
trained model, Qwen model, or cloned unique speaker.

## Supplied research reviewed

| Primary source | Relevant finding | Decision for Senko |
| --- | --- | --- |
| [Qwen3-TTS report](https://arxiv.org/pdf/2601.15621) and [implementation](https://github.com/QwenLM/Qwen3-TTS) | Description-based voice creation and reusable designed-voice references are supported; the released VoiceDesign model is 1.7B. Reported streaming latency is not a guarantee on this laptop. | Preferred future description-to-voice experiment on suitable compute. A generated approved anchor could later be reused for consistent speech. Do not label a smaller preset model as VoiceDesign. |
| [MOSS-TTS report](https://arxiv.org/pdf/2603.18090) and [implementation](https://github.com/OpenMOSS/MOSS-TTS) | Audio-token representation, speaker preservation, duration/pronunciation control and long-context stability must work together. | Keep model provenance, identity and duration checks separate from text generation. Its newer [Nano implementation](https://github.com/OpenMOSS/MOSS-TTS-Nano) is a CPU-oriented candidate for later comparison, not a tested backend here. |
| [F5-TTS paper](https://arxiv.org/pdf/2410.06885) and [code](https://github.com/SWivid/F5-TTS) | Flow matching with a DiT and inference sampling can produce natural zero-shot speech. | A useful architecture/reference-conditioned candidate. Inference speed reported in the paper is not applied to this CPU without measurements. No F5 model has been run here. |
| [EmoCtrl-TTS paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2024/12/SLT2024__EmoCtrlTTS.pdf) | Time-varying arousal/valence conditioning and nonverbal embeddings support expressive speech in a trained system. | Preserve emotional continuity and avoid random per-sentence speaker changes. Current mood controls are bounded pace/dynamics/texture controls; they do not implement EmoCtrl training, learned emotion conditioning, laughter or crying. |
| [ACL long-form benchmarking paper](https://aclanthology.org/2026.findings-acl.112.pdf) | Long-form evaluation covers acoustics, semantics and expression rather than one intelligibility score. | Test actual audio, content retention, consistency, duration, latency and playback separately. ASR scores cannot establish human-rated naturalness or superiority over another product. |

The papers and model/repository names were checked against their linked primary
sources. No universal performance comparison with OpenAI is claimed.

## Hardware and active implementation

The inspected machine has approximately 7.3 GiB visible RAM, less than 1 GiB free
at inspection, a Ryzen 5 7530U, and a CPU-only PyTorch build with no CUDA device.
Running the 1.7B VoiceDesign model alongside the app has not been attempted or
benchmarked. Its memory/compute needs make it a poor first local test under these
conditions. That is an engineering inference, not a claim that Qwen cannot run on
any CPU.

The tested local alternative is [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
using the pinned [kokoro-onnx runtime](https://github.com/thewh1teagle/kokoro-onnx),
version 0.4.7 and the model-files-v1.0 FP32 export. The active graph is about 326 MB
and the styles are about 28 MB. The earlier 92 MB INT8 graph is retained for comparison. The initial cold local run generated 4.52
seconds of speech in 6.37 seconds using the initial INT8 setup; that hybrid wrapper test took 8.13 seconds.
Neither measurement is streaming time-to-first-audio.

## Measured performance limits

The full 120-second-budget HTTP test timed out at the existing 60-second deadline. Smaller INT8 batches and the FP32 CPU export were also tried for the same long script; they did not resolve that deadline failure. The final CPU configuration uses six inference threads and phoneme batches capped at 160, preferring punctuation boundaries. These are performance settings, not changes to the chosen speaker blend.

An isolated DirectML environment detected the Radeon-compatible provider. The stock model failed at ConvTranspose. A separate layout-only export changed 1D transposed convolutions into equivalent singleton-height 2D operations; four numerical CPU equivalence tests passed. The rewritten graph then generated speech on DirectML, but took 6.20 seconds to load and 12.56 seconds to render 4.52 seconds of audio in that test. It was not selected for the app. No drivers or system settings were changed. The export remains a local research artifact, not an advertised faster backend. See the [official DirectML requirements](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) and [matching upstream operator issue](https://github.com/hexgrad/kokoro/issues/79).

The maximum duration remains a budget limit, not a latency guarantee. Long local generations may return HTTP 504 with no partial audio. Reliable low-latency long-form generation still needs better-performing compute or another benchmarked backend. This work does not claim that the long-form acceptance test passed.

## Character identity

`hybrid.json` fixes the style blend across all moods: 50% af_heart, 30% af_bella,
20% af_nicole. These are pretrained style embeddings, not three recorded tracks
mixed together. The result remains derived from the base model's published
speaker styles; it is not an independently trained or guaranteed unique speaker.

The 4.5% parallel texture applies band-limited modulation without changing sample
count, timing or the base pitch. Quiet moods reduce it further. The first hybrid
test measured waveform correlation 0.9997 with the dry neural output. This bounds
the signal change but is not a listening-quality rating. The intended result is
human phrasing with a slight synthetic edge, not a flat vocoder performance.

The model uses phonemization for linguistic input; its sound is produced by the
neural model rather than the earlier formant renderer. Long phoneme sequences
are split at boundaries before inference to prevent the pinned runtime's internal
length truncation. The server still rejects recordings exceeding the selected
duration and never returns an intentionally cut-off partial message.

## Local setup and persistence

`npm run voice:neural:setup` creates an isolated Python 3.13 environment, installs
the pinned lock file, downloads versioned public assets, hashes them, performs a
real cold synthesis, and only then selects `SENKO_VOICE_ENGINE=senko-hybrid` in
`.env.local`. It preserves unrelated settings. The default local global
concurrency is reduced to one to fit this machine; existing explicit settings are
preserved. Assets and the environment live under ignored `.data/voice/` storage.

`SENKO_NEURAL_PYTHON` can select another prepared interpreter. Explicit hybrid
selection fails accurately if assets/runtime are unavailable; it does not silently
substitute Zira or the formant bank. Cloud machines need this setup or an actual
configured custom inference worker. Local files are not uploaded or deployed by
this work.

Tests:

Final FP32 validation on this machine: all 30 corpus samples (six sentences in
each of five delivery settings) passed signal checks and had 0% word error rate
against faster-whisper base.en. This small scripted corpus does not establish
human naturalness, emotional realism, or a unique speaker identity.

The real application passed the 5- and 30-second-budget tests, producing 4.12 and
22.75 seconds of audio. A real generated podcast reply produced a 15.54-second
saved attachment. Browser playback advanced without a media error, seeking to
seven seconds worked, and the 390-pixel mobile viewport had no horizontal
overflow. Owner isolation, HTTP Range playback, queue admission and persistent
rate limits passed. The separate 120-second-budget case failed with HTTP 504 as
described above; it is not counted as a passing acceptance test.

- `npm run voice:neural:test`: real synthesis, limits, provenance, unavailable
  interpreter, cancellation and temporary-file cleanup.
- `.data/voice/neural-venv/Scripts/python.exe scripts/senko-hybrid-evaluate.py`:
  render the same 30-sample corpus used for the formant bank.
- `python scripts/senko-voice-evaluate.py .data/voice/hybrid/evaluation/manifest.json`:
  independent ASR/signal checks using the separate evaluator environment.
- Existing `scripts/voice-e2e.mjs` verifies the real app, saved audio, Range
  requests, owner isolation and shared quotas with `VOICE_TEST_ENGINE=senko-hybrid`.
