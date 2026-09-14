#!/usr/bin/env python3
"""Review/install the shared transaction in both known OpsBot geocode writers."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

WRITERS = ("geocode_junkware_appointments.py", "seed_local_appointment_geocodes.py")


def update(source):
    marker = "    cache = load_cache()\n"
    old = "write_json(GEOCODE_CACHE_PATH, cache)"
    if "merge_geocode_cache(GEOCODE_CACHE_PATH, cache_baseline, cache)" in source:
        return source
    if source.count(marker) != 1 or source.count(old) != 1:
        raise ValueError("Writer changed; review the migration before installing")
    tree = ast.parse(source)
    imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
    insertion = imports[-1].end_lineno
    lines = source.splitlines(keepends=True)
    lines.insert(insertion, "from copy import deepcopy\nfrom geocode_cache_transaction import merge_geocode_cache\n")
    result = "".join(lines).replace(marker, marker + "    cache_baseline = deepcopy(cache)\n")
    result = result.replace(old, "merge_geocode_cache(GEOCODE_CACHE_PATH, cache_baseline, cache)")
    compile(result, "geocode writer", "exec")
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path.home() / ".openclaw/workspace/opsbot"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--review", type=Path, required=True, help="Review manifest to write, or to match exactly when applying")
    args = parser.parse_args()
    directory = Path(args.root) / "scripts"
    candidates = {directory / name: update((directory / name).read_text()).encode() for name in WRITERS}
    candidates[directory / "geocode_cache_transaction.py"] = (Path(__file__).parent / "runtime/geocode_cache_transaction.py").read_bytes()
    originals = {file: file.read_bytes() if file.exists() else None for file in candidates}
    review = {file.name: {"before": digest(originals[file]) if originals[file] is not None else None, "after": digest(data)} for file, data in candidates.items()}
    if not args.apply:
        args.review.write_text(json.dumps(review, indent=2) + "\n")
        print("Prepared three-file review; runtime unchanged.")
        return
    if json.loads(args.review.read_text()) != review:
        raise ValueError("Source or candidate changed since review; no installation performed")
    backup = directory / "recurrence-transaction-backups"
    backup.mkdir(mode=0o700, exist_ok=True)
    # Install the helper first; every migrated writer must be able to import it.
    for file in reversed(candidates):
        if originals[file] == candidates[file]:
            continue
        if (file.read_bytes() if file.exists() else None) != originals[file]:
            raise ValueError("Runtime source changed during install; preserve it and review")
        if originals[file] is not None:
            saved = backup / (file.name + "." + digest(originals[file]))
            if not saved.exists():
                shutil.copy2(file, saved)
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(candidates[file]); stream.flush(); os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), file.stat().st_mode & 0o777 if file.exists() else 0o644)
        os.replace(temporary, file)
    print("Installed shared cache transaction; no collectors started or data rewritten.")


if __name__ == "__main__":
    main()
