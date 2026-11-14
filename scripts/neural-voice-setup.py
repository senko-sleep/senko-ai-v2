"""Download pinned, public inference assets into local ignored storage."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / ".data/voice/models/senko-hybrid-v1"
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = {"kokoro-v1.0.int8.onnx": 92361271, "kokoro-v1.0.onnx": 325532387, "voices-v1.0.bin": 28214398}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {"baseModel": "hexgrad/Kokoro-82M", "runtime": "kokoro-onnx==0.4.7", "exportRelease": "model-files-v1.0", "files": {}}
    for name, expected_size in FILES.items():
        target = DEST / name
        if not target.exists() or target.stat().st_size != expected_size:
            temp = target.with_suffix(target.suffix + ".partial")
            try:
                request = urllib.request.Request(BASE + name, headers={"User-Agent": "senko-neural-voice-setup"})
                with urllib.request.urlopen(request, timeout=60) as response, temp.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                if temp.stat().st_size != expected_size:
                    raise RuntimeError(f"Incomplete model download: {name}")
                os.replace(temp, target)
            finally:
                if temp.exists():
                    temp.unlink()
        with target.open("rb") as asset:
            digest = hashlib.file_digest(asset, "sha256").hexdigest()
        manifest["files"][name] = {"url": BASE + name, "bytes": expected_size, "sha256": digest}
        print(f"Ready: {name} ({expected_size:,} bytes)", flush=True)
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
