"""Lossless 1D -> singleton-height 2D ConvTranspose layout adapter for DirectML.

Does not retrain or alter weights. Writes a separate derived model and verifies
the operator rewrite numerically on CPU before exporting the full model.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto
import onnxruntime as ort


def convert(model):
    nodes, count = [], 0
    for node in model.graph.node:
        attrs = {a.name: helper.get_attribute_value(a) for a in node.attribute}
        if node.op_type != "ConvTranspose" or len(attrs.get("kernel_shape", [])) != 1:
            nodes.append(node)
            continue
        prefix = f"senko_dml_{count}"
        axes = prefix + "_axis"
        model.graph.initializer.append(numpy_helper.from_array(np.array([2], dtype=np.int64), axes))
        inputs = list(node.input)
        for i in [0, 1]:
            expanded = f"{prefix}_in{i}"
            nodes.append(helper.make_node("Unsqueeze", [inputs[i], axes], [expanded], name=expanded))
            inputs[i] = expanded
        for key in ["kernel_shape", "strides", "dilations"]:
            if key in attrs:
                attrs[key] = [1, attrs[key][0]]
        if "pads" in attrs:
            attrs["pads"] = [0, attrs["pads"][0], 0, attrs["pads"][1]]
        for key, first in [("output_padding", 0), ("output_shape", 1)]:
            if key in attrs:
                attrs[key] = [first, attrs[key][0]]
        expanded_output = prefix + "_out"
        nodes.append(helper.make_node("ConvTranspose", inputs, [expanded_output], name=node.name + "_2d", **attrs))
        nodes.append(helper.make_node("Squeeze", [expanded_output, axes], list(node.output), name=prefix + "_squeeze"))
        count += 1
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    onnx.checker.check_model(model)
    return model, count


def self_test():
    rng = np.random.default_rng(11)
    for group, stride, kernel, pad, out_pad in [(1, 2, 3, 1, 1), (4, 2, 3, 1, 1), (1, 10, 20, 5, 0), (1, 5, 20, 0, 0)]:
        x = rng.normal(size=(1, 4, 13)).astype(np.float32)
        w = rng.normal(size=(4, 4 // group, kernel)).astype(np.float32)
        graph = helper.make_graph([helper.make_node("ConvTranspose", ["x", "w"], ["y"], kernel_shape=[kernel], strides=[stride], dilations=[1], pads=[pad, pad], output_padding=[out_pad], group=group)], "test", [helper.make_tensor_value_info("x", TensorProto.FLOAT, list(x.shape))], [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 4, None])], [numpy_helper.from_array(w, "w")])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 20)], ir_version=9)
        before = ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"]).run(None, {"x": x})[0]
        changed, _ = convert(model)
        after = ort.InferenceSession(changed.SerializeToString(), providers=["CPUExecutionProvider"]).run(None, {"x": x})[0]
        np.testing.assert_allclose(before, after, rtol=1e-5, atol=1e-5)
    print("ConvTranspose layout equivalence: four real CPU cases passed", flush=True)


def main():
    self_test()
    root = Path(__file__).resolve().parent.parent / ".data/voice/models/senko-hybrid-v1"
    source = root / "kokoro-v1.0.onnx"
    model, count = convert(onnx.load(str(source)))
    target = root / "kokoro-v1.0-directml.onnx"
    onnx.save(model, str(target))
    manifest = json.loads((root / "manifest.json").read_text())
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest["files"][target.name] = {"source": source.name, "sourceSha256": manifest["files"][source.name]["sha256"], "transform": "ConvTranspose1D -> singleton-height ConvTranspose2D", "rewrittenOperators": count, "bytes": target.stat().st_size, "sha256": digest}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Exported {target.name}: {count} layout rewrites; original weights preserved", flush=True)


if __name__ == "__main__":
    main()
