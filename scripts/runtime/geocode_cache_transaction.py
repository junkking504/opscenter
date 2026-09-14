"""Compare-and-merge appointment geocodes without losing concurrent writers."""
import fcntl
import json
import os
from pathlib import Path
import tempfile


def merge_geocode_cache(path: Path, baseline: dict, proposal: dict) -> None:
    path = Path(path)
    for payload in (baseline, proposal):
        if not isinstance(payload, dict) or not isinstance(payload.get("addresses"), dict):
            raise ValueError("Invalid geocode transaction schema")
    original, proposed = baseline["addresses"], proposal["addresses"]
    if original.keys() - proposed.keys():
        raise ValueError("Geocode transactions cannot delete existing addresses")
    changes = {key: value for key, value in proposed.items() if key not in original or value != original[key]}
    path.parent.mkdir(parents=True, exist_ok=True)
    # A stable, separate lock inode survives atomic replacement of the cache.
    with path.with_suffix(path.suffix + ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads(path.read_text()) if path.exists() else {"schema_version": 1, "addresses": {}}
        if not isinstance(current, dict) or not isinstance(current.get("addresses"), dict):
            raise ValueError("Existing geocode cache is damaged; preserve it for review")
        saved = current["addresses"]
        missing = object()
        for key, value in changes.items():
            if saved.get(key, missing) != original.get(key, missing) and saved.get(key, missing) != value:
                raise ValueError("Concurrent geocode correction requires a fresh source read")
        saved.update(changes)
        current["schema_version"] = max(current.get("schema_version", 1), proposal.get("schema_version", 1))
        if changes and proposal.get("last_updated_at"):
            current["last_updated_at"] = max(str(current.get("last_updated_at", "")), str(proposal["last_updated_at"]))
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                if path.exists():
                    os.fchmod(stream.fileno(), path.stat().st_mode & 0o777)
                json.dump(current, stream, indent=2, ensure_ascii=False)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
