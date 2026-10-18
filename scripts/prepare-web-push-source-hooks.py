#!/usr/bin/env python3
"""Prepare runtime-writer patches for review. NEVER modifies a runtime file.

Reads source code only. Emits patched code in an explicit staging directory;
installing it is a separate approved deployment operation under writer locks.
Unknown anchors fail closed. No collector is executed.
"""
import argparse
import ast
from pathlib import Path


def patch_schedule(source):
    marker = "from opscenter_push_journal import publish_json"
    if marker in source:
        if "observation_started_at=push_schedule_started_at" not in source or "publisher=lambda: temp_path.replace(fast_path)" not in source:
            raise ValueError("legacy_schedule_hook_requires_explicit_replacement")
        return source
    old = "        temp_path.replace(fast_path)"
    if source.count(old) != 1:
        raise ValueError("schedule_fast_writer_anchor_changed")
    source = source.replace(old, '        publish_json(fast_path, json.loads(temp_path.read_text(encoding="utf-8")), publisher=lambda: temp_path.replace(fast_path), observation_started_at=push_schedule_started_at)', 1)
    tree = ast.parse(source)
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
             and node.func.value.id == "raw_path" and node.func.attr == "write_text"
             and node.args and isinstance(node.args[0], ast.Call)
             and isinstance(node.args[0].func, ast.Attribute) and node.args[0].func.attr == "dumps"
             and node.args[0].args and isinstance(node.args[0].args[0], ast.Dict)
             and any(isinstance(key, ast.Constant) and key.value == "appointments" for key in node.args[0].args[0].keys)]
    if len(calls) != 1:
        raise ValueError("schedule_raw_writer_anchor_changed")
    call = calls[0]
    lines = source.splitlines(keepends=True)
    begin = sum(len(line) for line in lines[:call.lineno-1]) + call.col_offset
    end = sum(len(line) for line in lines[:call.end_lineno-1]) + call.end_col_offset
    payload = ast.get_source_segment(source, call.args[0].args[0])
    original_call = ast.get_source_segment(source, call)
    source = source[:begin] + f"publish_json(raw_path, {payload}, publisher=lambda: {original_call}, observation_started_at=push_schedule_started_at)" + source[end:]
    main = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "main")
    lines = source.splitlines(keepends=True)
    lines.insert(main.body[0].lineno - 1, "    push_schedule_started_at = datetime.now(TIMEZONE).isoformat()\n")
    source = "".join(lines)
    # Insert after future imports without rewriting unrelated code.
    parsed = ast.parse(source)
    anchor = next(node for node in parsed.body if isinstance(node, (ast.Import, ast.ImportFrom)) and not (isinstance(node, ast.ImportFrom) and node.module == "__future__"))
    lines = source.splitlines(keepends=True)
    lines.insert(anchor.lineno - 1, marker + "\n")
    source = "".join(lines)
    ast.parse(source)
    return source


def patch_fleet(source):
    marker = "from opscenter_push_journal import publish_json"
    if marker in source:
        if "publisher=lambda: _original_write_json(path, payload)" not in source:
            raise ValueError("legacy_fleet_hook_requires_explicit_replacement")
        return source
    anchor = "from linxup_collection_safety import request_json, run_collector"
    if source.count(anchor) != 1 or '"pagination_completed": pagination_completed' not in source:
        raise ValueError("fleet_verified_writer_anchor_changed")
    wrapper = marker + "\n_original_write_json = write_json\ndef write_json(path, payload):\n    return publish_json(path, payload, publisher=lambda: _original_write_json(path, payload))"
    result = source.replace(anchor, anchor + "\n" + wrapper, 1)
    ast.parse(result)
    return result


def prepare(root, output):
    if output.exists():
        raise ValueError("staging_directory_must_be_new")
    changes = {}
    for name, patch in [("collect_junkware_daily.py", patch_schedule), ("collect_linxup_alerts.py", patch_fleet)]:
        changes[name] = patch((root / "scripts" / name).read_text())
    for name in ["source_aware_metrics.py", "opscenter_push_journal.py"]:
        changes[name] = Path(__file__).with_name(name).read_text()
    output.mkdir(parents=True, mode=0o700)
    for name, value in changes.items():
        (output / name).write_text(value)
    print("Prepared four source files for review only; runtime unchanged.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.root, args.output)
