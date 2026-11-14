"""Load the hyphenated CLI module from its fixed project path."""
import importlib.util
from pathlib import Path


def load_hybrid():
    spec = importlib.util.spec_from_file_location("senko_hybrid_runtime", Path(__file__).with_name("senko-hybrid.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
