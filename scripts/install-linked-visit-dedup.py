#!/usr/bin/env python3
"""Install reviewed linked estimate/job visit de-duplication into OpsBot."""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BASELINES = {
    "match_linxup_appointment_visits.py": "8937bc29f0222ba305660bfc46c8d526b47a9df1fec036bbc0289611dc3ab42e",
    "validate_linxup_appointment_visits.py": "1cde15785ac35fa4807f0f4932bf90689e1f8eb95b6d153c7de9657c6c4d3331",
}
INSTALLED = {
    "match_linxup_appointment_visits.py": "a75f0cd638fc696324d79bff1ace57a42231db0ad41dac1cfbdf40f2bc00ecc3",
    "validate_linxup_appointment_visits.py": "2619cbc188cd54a14a1cff4db1f34e076aea7dff88ae813f868bcc7928ed369d",
    "linked_visit_dedup.py": "aa994088702b30622b381b4a60b6cc0c9ceeeb32b7ad39b14c26176de5b6d7fd",
}
SOURCE = Path(__file__).resolve().parent / "runtime" / "linked_visit_dedup.py"


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"Unexpected {label} source shape; expected one reviewed anchor")
    return source.replace(old, new, 1)


def patch_matcher(source: str) -> str:
    if "from linked_visit_dedup import reconcile_linked_physical_visits" in source:
        return source
    source = replace_once(source, "from geocode_junkware_appointments import address_hash, normalize_address\n", "from geocode_junkware_appointments import address_hash, normalize_address\nfrom linked_visit_dedup import reconcile_linked_physical_visits\n", "matcher import")
    source = replace_once(source, "    # Unique appointment/truck rows are mandatory.\n", "    output = reconcile_linked_physical_visits(output, target, DATA, parse_timestamp, iso_utc, normalize_truck)\n\n    # Unique appointment/truck rows are mandatory.\n", "matcher reconciliation")
    return source


def patch_validator(source: str) -> str:
    if "duplicate_physical_visit_across_appointments" in source:
        return source
    source = replace_once(source, "    keys: set[tuple[str, Any]] = set()\n", "    keys: set[tuple[str, Any]] = set()\n    physical_owners: dict[tuple[str, str, str], set[str]] = {}\n", "validator state")
    anchor = '''        if int(row.get("visit_count") or 0) != len(visits):
            failures.append("visit_count_mismatch")
'''
    replacement = anchor + '''        if row.get("match_confidence") == "confirmed" and not row.get("pass_by_only"):
            for visit in visits:
                arrival, departure = str(visit.get("arrival") or ""), str(visit.get("departure") or "")
                if arrival and departure:
                    signature = (str(row.get("truck_number") or ""), arrival, departure)
                    physical_owners.setdefault(signature, set()).add(key[0])
'''
    source = replace_once(source, anchor, replacement, "validator episode index")
    source = replace_once(source, "    counts = Counter(str(row.get(\"match_confidence\")) for row in rows)\n", "    if any(len(owners) > 1 for owners in physical_owners.values()):\n        failures.append(\"duplicate_physical_visit_across_appointments\")\n    counts = Counter(str(row.get(\"match_confidence\")) for row in rows)\n", "validator collision check")
    return source


PATCHERS = {
    "match_linxup_appointment_visits.py": patch_matcher,
    "validate_linxup_appointment_visits.py": patch_validator,
}


def install(root: Path, apply: bool = False) -> list[str]:
    changes: list[tuple[Path, bytes, bytes]] = []
    for name, patcher in PATCHERS.items():
        destination = root / "scripts" / name
        old = destination.read_bytes()
        old_hash = digest(old)
        if old_hash == INSTALLED[name]:
            continue
        if old_hash != BASELINES[name]:
            raise RuntimeError(f"Unreviewed runtime drift: {name}; inspect and reconcile before installing")
        new = patcher(old.decode("utf-8")).encode("utf-8")
        compile(new, str(destination), "exec")
        if digest(new) != INSTALLED[name]:
            raise RuntimeError(f"Reviewed installed hash mismatch: {name}")
        changes.append((destination, old, new))
    helper_destination = root / "scripts" / "linked_visit_dedup.py"
    helper = SOURCE.read_bytes()
    old_helper = helper_destination.read_bytes() if helper_destination.exists() else None
    if old_helper is not None and digest(old_helper) != INSTALLED["linked_visit_dedup.py"]:
        raise RuntimeError("Unreviewed runtime drift: linked_visit_dedup.py; inspect and reconcile before installing")
    if old_helper != helper:
        if digest(helper) != INSTALLED["linked_visit_dedup.py"]:
            raise RuntimeError("Reviewed installed hash mismatch: linked_visit_dedup.py")
        changes.append((helper_destination, old_helper or b"", helper))
    if apply and changes:
        backup = root / "backups" / ("linked-visit-dedup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        backup.mkdir(parents=True, mode=0o700)
        for destination, old, _ in changes:
            if destination.exists():
                shutil.copy2(destination, backup / destination.name)
        for destination, old, new in changes:
            if (destination.read_bytes() if destination.exists() else b"") != old:
                raise RuntimeError(f"Runtime changed during install: {destination.name}")
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
                handle.write(new)
                staged = Path(handle.name)
            os.chmod(staged, destination.stat().st_mode & 0o777 if destination.exists() else 0o644)
            os.replace(staged, destination)
        print(f"Backup: {backup}")
    for destination, _, _ in changes:
        print(("Installed: " if apply else "Would install: ") + destination.name)
    if not changes:
        print("Linked-visit de-duplication already installed")
    return [destination.name for destination, _, _ in changes]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".openclaw/workspace/opsbot")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    install(args.root, args.apply)
