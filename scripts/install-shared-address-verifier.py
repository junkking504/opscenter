#!/usr/bin/env python3
"""Route the local OpsBot geocoder through the deployed shared verifier."""
import argparse
import ast
from pathlib import Path

BRIDGE = '''def geocode(address: str, *, allow_local_cache: bool = True) -> dict[str, Any]:
    """Verify the entire source address with the same code as all OpsCenter maps."""
    import subprocess
    release = Path.home() / "opscenter-v2" / "opscenter"
    try:
        completed = subprocess.run(
            ["/opt/homebrew/bin/node", "--import", "tsx", "scripts/resolve-service-address.ts"],
            cwd=release, input=json.dumps({"address": address}), text=True,
            capture_output=True, timeout=35, check=True,
        )
        result = json.loads(completed.stdout)
        point = result.get("location")
        if not point:
            return ambiguous_address_result(address, "Shared full-address verifier", result.get("reason", "unavailable"))
        return with_service_area_validation({
            "latitude": point["latitude"], "longitude": point["longitude"],
            "geocoder_source": "Shared full-address verifier / Census",
            "match_confidence": "confirmed", "house_street_verified": True,
            "normalized_address": normalize_address(address),
            "collection_timestamp": collected_at(), "reason": result.get("reason", "verified"),
        })
    except Exception:
        return ambiguous_address_result(address, "Shared full-address verifier", "address_verification_unavailable")
'''

def update(source):
    function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'geocode')
    lines = source.splitlines(keepends=True)
    lines[function.lineno-1:function.end_lineno] = [BRIDGE]
    return ''.join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path.home()/'.openclaw/workspace/opsbot'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    file = Path(args.root)/'scripts/geocode_junkware_appointments.py'
    source = file.read_text()
    updated = update(source)
    compile(updated,str(file),'exec')
    if source == updated:
        print('Shared address verifier already installed.')
    elif args.apply:
        file.write_text(updated)
        print('Installed shared address verifier for future collector lookups.')
    else:
        print('Would install shared address verifier for future collector lookups.')

if __name__ == '__main__':
    main()
