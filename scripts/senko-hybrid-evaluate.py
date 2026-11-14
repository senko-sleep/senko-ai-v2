"""Render a corpus with one warm neural session; ASR evaluation runs separately."""
import json
from pathlib import Path
import time

import soundfile as sf
from senko_hybrid_import import load_hybrid


def main():
    root = Path(__file__).resolve().parent.parent
    config = json.loads((root / "voice/senko/evaluation.json").read_text())
    output = root / ".data/voice/hybrid/evaluation"
    output.mkdir(parents=True, exist_ok=True)
    model = load_hybrid().SenkoHybrid()
    cases = []
    for mood in config["moods"]:
        for index, text in enumerate(config["heldOut"]):
            start = time.monotonic()
            audio, sample_rate, meta = model.render(text, mood, 30)
            file = output / f"{mood}-{index}.wav"
            sf.write(file, audio, sample_rate, subtype="PCM_16")
            cases.append({"file": file.relative_to(root).as_posix(), "text": text, "mood": mood, "model": meta["model"], "fingerprint": meta["fingerprint"], "synthesisMs": round((time.monotonic() - start) * 1000), "seconds": meta["seconds"], "sampleRate": sample_rate, "textureCorrelation": meta["textureCorrelation"], "bytes": file.stat().st_size})
        print(f"Rendered neural {mood}: {len(config['heldOut'])} samples", flush=True)
    (output / "manifest.json").write_text(json.dumps({"cases": cases, "evaluation": config}, indent=2))


if __name__ == "__main__":
    main()
