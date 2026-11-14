"""Independent ASR, signal and pitch checks over real generated Senko samples."""
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel


def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, a in enumerate(reference, 1):
        current = [i]
        for j, b in enumerate(hypothesis, 1):
            current.append(min(previous[j] + 1, current[-1] + 1, previous[j - 1] + (a != b)))
        previous = current
    return previous[-1]


def audio_metrics(file):
    with wave.open(file, "rb") as wav:
        rate = wav.getframerate()
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float64) / 32768
    peak = float(np.max(np.abs(data)))
    rms = float(np.sqrt(np.mean(data ** 2)))
    f0 = []
    frame_length = int(rate * .04)
    for start in range(0, len(data) - frame_length, int(rate * .025)):
        frame = data[start:start + frame_length]
        if np.sqrt(np.mean(frame ** 2)) < .025:
            continue
        frame = (frame - np.mean(frame)) * np.hanning(frame_length)
        corr = np.correlate(frame, frame, "full")[frame_length - 1:]
        low, high = int(rate / 420), int(rate / 90)
        lag = low + int(np.argmax(corr[low:high]))
        if corr[lag] / max(corr[0], 1e-12) > .55:
            f0.append(rate / lag)
    return {"peak": peak, "rms": rms, "clippedSamples": int(np.sum(np.abs(data) >= .999)), "medianF0": float(np.median(f0)) if f0 else 0}


def main():
    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text())
    recognizer = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=4, download_root=".data/voice/tools/whisper")
    errors = total = 0
    for case in manifest["cases"]:
        segments, _ = recognizer.transcribe(case["file"], language="en", beam_size=5, vad_filter=False, condition_on_previous_text=False, temperature=0)
        transcript = " ".join(segment.text.strip() for segment in segments)
        reference, hypothesis = words(case["text"]), words(transcript)
        mistakes = distance(reference, hypothesis)
        errors += mistakes
        total += len(reference)
        case.update({"transcript": transcript, "wordErrorRate": mistakes / len(reference), **audio_metrics(case["file"])})
    aggregate = errors / total
    max_case = max(case["wordErrorRate"] for case in manifest["cases"])
    settings = manifest["evaluation"]
    signal_ok = all(c["clippedSamples"] == 0 and .005 < c["rms"] < .5 and c["medianF0"] > 0 for c in manifest["cases"])
    passed = signal_ok and aggregate <= settings["maxAggregateWordErrorRate"] and max_case <= settings["maxCaseWordErrorRate"]
    summary = {"passed": passed, "cases": len(manifest["cases"]), "aggregateWordErrorRate": aggregate, "maxCaseWordErrorRate": max_case, "signalChecksPassed": signal_ok,
               "recognizer": "faster-whisper base.en int8 CPU", "casesByMood": {mood: {"meanSeconds": float(np.mean([c["seconds"] for c in manifest["cases"] if c["mood"] == mood])), "medianF0": float(np.median([c["medianF0"] for c in manifest["cases"] if c["mood"] == mood]))} for mood in settings["moods"]}}
    output = {"summary": summary, "cases": manifest["cases"]}
    (manifest_path.parent / "results.json").write_text(json.dumps(output, indent=2))
    print(json.dumps(summary, indent=2))
    if not passed:
        print("Failed cases:", [(c["file"], c["wordErrorRate"], c["transcript"]) for c in manifest["cases"] if c["wordErrorRate"] > settings["maxCaseWordErrorRate"]])
        raise SystemExit(1)


if __name__ == "__main__":
    main()
