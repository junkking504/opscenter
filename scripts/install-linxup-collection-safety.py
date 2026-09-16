#!/usr/bin/env python3
"""Check/install reviewed OpsBot collector source; never restart services or collect."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "runtime" / "linxup"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def patched_source(name, old):
    """Apply only the reviewed delta; including the account-documented API host."""
    with tempfile.TemporaryDirectory(prefix="linxup-source-check-") as directory:
        staged = Path(directory) / name
        staged.write_bytes(old)
        subprocess.run(["/usr/bin/patch", "--batch", "--forward", str(staged), str(SOURCE / (name + ".patch"))],
                       check=True, capture_output=True)
        return staged.read_bytes()


def install(root, apply=False):
    baseline = json.loads((SOURCE / "baseline-sha256.json").read_text())
    installed = json.loads((SOURCE / "installed-sha256.json").read_text())
    previous = json.loads((SOURCE / "previous-installed-sha256.json").read_text())
    names = ["linxup_collection_safety.py", *baseline]
    changes = []
    for name in names:
        destination = root / "scripts" / name
        old = destination.read_bytes() if destination.exists() else None
        if name in installed and old is not None and digest(old) == installed[name]:
            continue
        if name in baseline:
            if old is None or digest(old) not in (baseline[name], previous.get(name)):
                raise RuntimeError(f"Unreviewed runtime drift: {name}; inspect and reconcile before installing")
            original = (SOURCE.parents[1] / "fixtures" / "linxup" / name).read_bytes()
            if digest(original) != baseline[name]:
                raise RuntimeError(f"Reviewed baseline hash mismatch: {name}")
            new = patched_source(name, original)
            if digest(new) != installed[name]:
                raise RuntimeError(f"Reviewed patch hash mismatch: {name}")
        else:
            new = (SOURCE / name).read_bytes()
        compile(new, str(destination), "exec")
        if old == new:
            continue
        if name not in baseline and old is not None:
            raise RuntimeError(f"Unreviewed existing helper: {name}")
        changes.append((destination, old, new))
    if apply and changes:
        backup = root / "backups" / ("linxup-collection-safety-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        backup.mkdir(parents=True, mode=0o700)
        for path, old, new in changes:
            if old is not None:
                shutil.copy2(path, backup / path.name)
        # The rollout owner must hold off collectors during this short multi-file install.
        for path, old, new in changes:
            current = path.read_bytes() if path.exists() else None
            if current != old:
                raise RuntimeError(f"Runtime changed during install: {path.name}")
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                handle.write(new)
                staged = Path(handle.name)
            os.chmod(staged, path.stat().st_mode & 0o777 if path.exists() else 0o644)
            os.replace(staged, path)
        print(f"Backup: {backup}")
    for path, _, _ in changes:
        print(("Installed: " if apply else "Would install: ") + path.name)
    if not changes:
        print("All four LinxUp source files match the reviewed version")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".openclaw/workspace/opsbot")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    install(args.root, args.apply)
