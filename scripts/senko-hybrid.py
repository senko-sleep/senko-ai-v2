"""Natural neural speech plus a restrained synthetic texture; no voice cloning or training.

When a director performance plan is supplied, each segment is rendered with its own continuous
prosody (pace, energy, pitch, timbre blend, pause) and vocal segments are performed as IPA
vocalizations or synthesized breaths — never read aloud as stage-direction words.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent


def select_mood(emotion):
    value = (emotion or "").lower()
    for pattern, mood in [(r"sleep|eepy|tired", "sleepy"), (r"sass|smug|teas|proud", "sassy"), (r"excit|happy|playful|giddy|hyp|energetic|joy", "excited"), (r"soft|calm|cozy|gentle|sad|mellow|intimate", "soft")]:
        if re.search(pattern, value):
            return mood
    return "neutral"


def hybrid_texture(audio, sample_rate, config, scale=1.0):
    """Keep timing/pitch intact; add a quiet, band-limited parallel modulation layer."""
    amount = float(config["amount"]) * max(0.0, min(2.0, float(scale)))
    if not 0 <= amount <= .12:
        amount = max(0.0, min(.12, amount))
    source = np.asarray(audio, dtype=np.float64)
    if not len(source):
        return source.astype(np.float32)
    alpha = 1 - math.exp(-2 * math.pi * config["lowpassHz"] / sample_rate)
    filtered = np.empty_like(source)
    value = 0.0
    for i, sample in enumerate(source):
        value += alpha * (sample - value)
        filtered[i] = value
    t = np.arange(len(source), dtype=np.float64) / sample_rate
    carrier = .65 * np.cos(2 * np.pi * config["carrierHz"] * t) + .35 * np.cos(2 * np.pi * (config["carrierHz"] + 17) * t)
    result = source * (1 - amount) + filtered * carrier * amount
    peak = np.max(np.abs(result)) if len(result) else 0
    if peak > .92:
        result *= .92 / peak
    return result.astype(np.float32)


def shift_pitch_keep_duration(audio, semitones):
    """Subtle pitch shift via short-window overlap-add resampling when semitones != 0."""
    st = max(-3.0, min(3.0, float(semitones or 0.0)))
    if abs(st) < 0.08 or len(audio) < 600:
        return np.asarray(audio, dtype=np.float32)
    ratio = 2.0 ** (st / 12.0)
    src = np.asarray(audio, dtype=np.float64)
    win = 960
    hop_out = 240
    hop_in = hop_out * ratio
    window = np.hanning(win)
    out = np.zeros(len(src) + win, dtype=np.float64)
    norm = np.zeros(len(src) + win, dtype=np.float64)
    pos_in = 0.0
    pos_out = 0
    idx_base = np.arange(win, dtype=np.float64) * ratio
    while pos_out + win <= len(src) and int(pos_in + idx_base[-1]) + 1 < len(src):
        idx = pos_in + idx_base
        i0 = idx.astype(np.int64)
        frac = idx - i0
        grain = (src[i0] * (1.0 - frac) + src[i0 + 1] * frac) * window
        out[pos_out:pos_out + win] += grain
        norm[pos_out:pos_out + win] += window * window
        pos_in += hop_in
        pos_out += hop_out
    mask = norm > 1e-6
    res = np.zeros(len(src), dtype=np.float64)
    usable = min(len(src), len(out))
    m = mask[:usable]
    res[:usable][m] = out[:usable][m] / norm[:usable][m]
    if not m.all():
        res[:usable][~m] = src[:usable][~m]
    return res.astype(np.float32)


def synth_breath(sample_rate, kind="exhale", ms=420, energy=0.9):
    """Band-passed shaped airflow for sighs/gasps/exhales when requested by the director."""
    dur = max(0.08, min(1.4, float(ms) / 1000.0))
    n = int(sample_rate * dur)
    rng = np.random.default_rng(1337 + n + (1 if kind == "inhale" else 0))
    noise = rng.standard_normal(n)
    # Band-limit between ~280 Hz and ~2600 Hz
    lp = 1 - math.exp(-2 * math.pi * 2600 / sample_rate)
    hp = 1 - math.exp(-2 * math.pi * 280 / sample_rate)
    low, high = 0.0, 0.0
    shaped = np.empty(n, dtype=np.float64)
    for i, x in enumerate(noise):
        low += lp * (x - low)
        high += hp * (low - high)
        shaped[i] = low - high
    t = np.linspace(0.0, 1.0, n)
    env = np.sin(np.pi * (t ** (0.65 if kind == "exhale" else 1.35))) ** 1.4
    gain = 0.045 * max(0.4, min(1.2, float(energy)))
    return (shaped * env * gain).astype(np.float32)


def fade_edges(audio, sample_rate, ms=8):
    n = min(len(audio) // 3, int(sample_rate * ms / 1000.0))
    if n <= 1:
        return audio
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    out = audio.copy()
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out


class SenkoHybrid:
    def __init__(self, config=None):
        self.config = config or json.loads((ROOT / "voice/senko/hybrid.json").read_text(encoding="utf-8"))
        model_dir = ROOT / ".data/voice/models" / self.config["id"]
        options = ort.SessionOptions()
        options.intra_op_num_threads = min(6, max(1, self.config.get("cpuThreads", 2)))
        options.inter_op_num_threads = 1
        provider = self.config.get("executionProvider", "CPUExecutionProvider")
        if provider not in ort.get_available_providers():
            raise ValueError(f"Configured execution provider is unavailable: {provider}")
        if provider == "DmlExecutionProvider":
            options.enable_mem_pattern = False
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(str(model_dir / self.config["modelFile"]), sess_options=options, providers=[provider, "CPUExecutionProvider"] if provider != "CPUExecutionProvider" else [provider])
        if {entry.name: entry.type for entry in self.session.get_inputs()} != {"tokens": "tensor(int64)", "style": "tensor(float)", "speed": "tensor(float)"}:
            raise ValueError("Unexpected neural model input contract")
        self.model = Kokoro.from_session(self.session, str(model_dir / "voices-v1.0.bin"))
        weights = self.config["styleBlend"]
        if abs(sum(weights.values()) - 1) > 1e-6 or any(weight < 0 for weight in weights.values()):
            raise ValueError("Voice blend weights must sum to one")
        self.voices = {name: self.model.get_voice_style(name).astype(np.float32) for name in weights}
        self.style = sum(self.voices[name] * weight for name, weight in weights.items()).astype(np.float32)
        manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
        active_assets = {name: manifest["files"][name] for name in [self.config["modelFile"], "voices-v1.0.bin"]}
        self.fingerprint = hashlib.sha256(json.dumps({"config": self.config, "assets": active_assets}, sort_keys=True).encode()).hexdigest()[:16]

    def blended_style(self, timbre=None):
        """Modulate Senko's core voice blend continuously from the director's timbre vector."""
        if not isinstance(timbre, dict) or not {"af_heart", "af_bella", "af_nicole"}.issubset(self.voices):
            return self.style
        base = self.config["styleBlend"]
        w = float(timbre.get("warmth", 0.5)) - 0.5
        b = float(timbre.get("brightness", 0.3)) - 0.3
        a = float(timbre.get("breathiness", 0.2)) - 0.2
        raw = {
            "af_heart": max(0.25, base["af_heart"] + 0.22 * w),
            "af_bella": max(0.10, base["af_bella"] + 0.22 * b),
            "af_nicole": max(0.08, base["af_nicole"] + 0.22 * a),
        }
        total = sum(raw.values())
        return sum(self.voices[k] * (v / total) for k, v in raw.items()).astype(np.float32)

    def _split_phonemes(self, phonemes):
        batches, current = [], ""
        batch_limit = min(440, max(80, self.config.get("maxPhonemesPerBatch", 160)))
        for word in phonemes.split():
            if len(word) > batch_limit:
                raise ValueError("A token is too long to pronounce safely")
            if len(current) + len(word) + 1 > batch_limit:
                batches.append(current)
                current = word
            else:
                current = f"{current} {word}".strip()
            if len(current) >= batch_limit * .55 and current.endswith((".", "!", "?", ";", ",")):
                batches.append(current)
                current = ""
        if current:
            batches.append(current)
        return batches

    def _render_plan(self, plan, mood, delivery, max_seconds, progress):
        segments = [s for s in (plan.get("segments") or []) if isinstance(s, dict)]
        if not segments:
            raise ValueError("Performance plan contains no segments")
        sample_rate = int(self.config.get("sampleRate", 24000))
        pieces, dry_pieces, sample_count = [], [], 0

        def report(phase, completed, seconds=0):
            if progress:
                progress({"phase": phase, "completed": completed, "total": len(segments), "seconds": seconds})

        report("synthesizing", 0)
        for index, seg in enumerate(segments):
            prosody = seg.get("prosody") or {}
            pace = max(0.75, min(1.3, float(prosody.get("pace", 1.0)))) * delivery["speed"]
            energy = max(0.55, min(1.2, float(prosody.get("energy", 1.0)))) * delivery["gain"]
            pitch = max(-3.0, min(3.0, float(prosody.get("pitch", 0.0))))
            pause_ms = max(0, min(1500, int(prosody.get("pauseAfterMs", 0))))
            style = self.blended_style(prosody.get("timbre"))
            seg_chunks = []

            if seg.get("kind") == "vocal":
                ipa = (seg.get("ipa") or "").strip()
                if ipa:
                    try:
                        v_audio, sample_rate = self.model.create(ipa, voice=style, speed=pace, lang=self.config["language"], is_phonemes=True)
                        v_audio = np.asarray(v_audio, dtype=np.float32).reshape(-1)
                        if len(v_audio) and np.isfinite(v_audio).all():
                            seg_chunks.append(fade_edges(shift_pitch_keep_duration(v_audio, pitch) * energy, sample_rate))
                    except Exception:
                        pass
                breath = seg.get("breath")
                if isinstance(breath, dict) and breath.get("kind") in ("exhale", "inhale"):
                    seg_chunks.append(synth_breath(sample_rate, breath["kind"], breath.get("ms", 420), energy))
            else:
                raw_text = re.sub(r"\s+", " ", (seg.get("text") or "").replace("—", ", ").replace("–", ", ")).strip()
                if raw_text:
                    if raw_text[-1] not in ".!?,;:…":
                        raw_text += "."
                    phonemes = self.model.tokenizer.phonemize(raw_text, self.config["language"])
                    for batch in self._split_phonemes(phonemes):
                        b_audio, sample_rate = self.model.create(batch, voice=style, speed=pace, lang=self.config["language"], is_phonemes=True)
                        b_audio = np.asarray(b_audio, dtype=np.float32).reshape(-1)
                        if not len(b_audio) or not np.isfinite(b_audio).all():
                            raise ValueError("The neural model returned invalid audio")
                        seg_chunks.append(fade_edges(shift_pitch_keep_duration(b_audio, pitch) * energy, sample_rate))

            if seg_chunks:
                dry_seg = np.concatenate(seg_chunks)
                t_scale = delivery["textureScale"] * (0.75 + 0.25 * min(1.2, energy))
                wet_seg = hybrid_texture(dry_seg, sample_rate, self.config["texture"], t_scale)
                dry_pieces.append(dry_seg)
                pieces.append(wet_seg)
                sample_count += len(wet_seg)

            if pause_ms > 0 and index < len(segments) - 1:
                pause = np.zeros(int(sample_rate * (pause_ms / 1000.0)), dtype=np.float32)
                dry_pieces.append(pause)
                pieces.append(pause)
                sample_count += len(pause)

            if sample_count / sample_rate > max_seconds + .05:
                raise ValueError("Generated speech exceeds the selected duration limit")
            report("synthesizing", index + 1, sample_count / sample_rate)

        if not pieces or sample_count == 0:
            raise ValueError("The performance produced no audio")
        report("assembling", len(segments), sample_count / sample_rate)
        dry = np.concatenate(dry_pieces)
        audio = np.concatenate(pieces)
        corr = float(np.corrcoef(dry, audio)[0, 1]) if np.std(dry) > 1e-6 and np.std(audio) > 1e-6 else 1.0
        return audio, sample_rate, {
            "seconds": len(audio) / sample_rate,
            "segments": len(segments),
            "mood": mood,
            "performance": plan.get("source", "director"),
            "character": plan.get("character", "Senko"),
            "model": self.config["id"],
            "baseModel": self.config["baseModel"],
            "modelKind": self.config["kind"],
            "fingerprint": self.fingerprint,
            "voice": "Senko (neural hybrid voice)",
            "textureCorrelation": corr,
            "executionProviders": self.session.get_providers(),
        }

    def render(self, text, emotion="neutral", max_seconds=30, progress=None, plan=None):
        if not isinstance(text, str) or not text.strip() or len(text) > 1500:
            raise ValueError("Speech text must contain 1–1500 characters")
        if not isinstance(max_seconds, (int, float)) or not 5 <= max_seconds <= 120:
            raise ValueError("Voice duration must be 5–120 seconds")
        mood = select_mood(emotion)
        delivery = self.config["moods"][mood]
        if isinstance(plan, dict) and isinstance(plan.get("segments"), list) and plan["segments"]:
            return self._render_plan(plan, mood, delivery, max_seconds, progress)
        text = re.sub(r"\s+", " ", text.replace("—", ", ").replace("–", ", ")).strip()
        if text[-1] not in ".!?":
            text += "."
        phonemes = self.model.tokenizer.phonemize(text, self.config["language"])
        batches = self._split_phonemes(phonemes)
        if not batches:
            raise ValueError("The text contains no speakable words")

        def report(phase, completed, seconds=0):
            if progress:
                progress({"phase": phase, "completed": completed, "total": len(batches), "seconds": seconds})

        report("synthesizing", 0)
        pieces, sample_count = [], 0
        for index, batch in enumerate(batches):
            audio, sample_rate = self.model.create(batch, voice=self.style, speed=delivery["speed"], lang=self.config["language"], is_phonemes=True)
            audio = np.asarray(audio, dtype=np.float32).reshape(-1)
            if not len(audio) or not np.isfinite(audio).all():
                raise ValueError("The neural model returned invalid audio")
            pieces.append(audio)
            sample_count += len(audio)
            if index < len(batches) - 1:
                pause = np.zeros(int(sample_rate * .08), dtype=np.float32)
                pieces.append(pause)
                sample_count += len(pause)
            if sample_count / sample_rate > max_seconds + .05:
                raise ValueError("Generated speech exceeds the selected duration limit")
            report("synthesizing", index + 1, sample_count / sample_rate)
        report("assembling", len(batches), sample_count / sample_rate)
        dry = np.concatenate(pieces)
        audio = hybrid_texture(dry * delivery["gain"], sample_rate, self.config["texture"], delivery["textureScale"])
        return audio, sample_rate, {"seconds": len(audio) / sample_rate, "segments": len(batches), "mood": mood, "model": self.config["id"], "baseModel": self.config["baseModel"], "modelKind": self.config["kind"], "fingerprint": self.fingerprint, "voice": "Senko (neural hybrid voice)", "textureCorrelation": float(np.corrcoef(dry, audio)[0, 1]), "executionProviders": self.session.get_providers()}


def main():
    request_file, output_file = map(Path, sys.argv[1:3])
    request = json.loads(request_file.read_text(encoding="utf-8"))
    start = time.monotonic()
    model = SenkoHybrid()
    audio, sample_rate, meta = model.render(
        request["text"],
        request.get("emotion", "neutral"),
        request.get("durationSeconds", 30),
        progress=lambda value: print(json.dumps({"type": "progress", "progress": value}), flush=True),
        plan=request.get("plan"),
    )
    sf.write(str(output_file), audio, sample_rate, subtype="PCM_16")
    meta["synthesisMs"] = round((time.monotonic() - start) * 1000)
    print(json.dumps(meta), flush=True)


if __name__ == "__main__":
    main()
