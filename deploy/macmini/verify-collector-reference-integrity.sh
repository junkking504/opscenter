#!/bin/bash
# Verify that collector code can only reference scripts that exist in the
# immutable release being prepared. This deliberately scans both release-owned
# collector wrappers and the live OpsBot refresh entrypoint, because the latter
# dereferences OPSCENTER_DIR on every cycle.
set -Eeuo pipefail

usage() {
  echo "usage: $0 --release <immutable-release-dir> [--collector-source <path>]" >&2
  exit 64
}

release=""
collector_sources=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --release) release="${2:-}"; shift 2 ;;
    --collector-source) collector_sources+=("${2:-}"); shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$release" ] || usage
[ -d "$release" ] || { echo "Collector reference integrity failed: release directory is missing: $release" >&2; exit 1; }

for source in "${collector_sources[@]:-}"; do
  [ -f "$source" ] || { echo "Collector reference integrity failed: collector source is missing: $source" >&2; exit 1; }
done

/usr/bin/python3 - "$release" "${collector_sources[@]:-}" <<'PY'
import re
import sys
from pathlib import Path

release = Path(sys.argv[1]).resolve()
extra_sources = [Path(value).resolve() for value in sys.argv[2:] if value]
sources = []
for path in sorted((release / "scripts").glob("run-*.sh")):
    if "refresh" in path.name or "detector" in path.name:
        sources.append(path)
sources.extend(sorted((release / "deploy" / "macmini" / "production-launchd").glob("*.plist")))
sources.extend(extra_sources)

references: set[tuple[Path, str]] = set()
release_path = str(release)
absolute_patterns = [
    # Shell paths rooted in OPSCENTER_DIR, including helpers sourced by OpsBot.
    re.compile(r"(?:\$\{?OPSCENTER_DIR\}?|/Users/missioncontrol/opscenter-v2/opscenter)/(scripts/[A-Za-z0-9_./-]+\.(?:sh|py|ts|tsx|mjs|js)|deploy/[A-Za-z0-9_./-]+\.sh)"),
    # TypeScript process.cwd() shell-outs.
    re.compile(r"path\.join\(process\.cwd\(\),\s*[\"'](scripts)[\"'],\s*[\"']([A-Za-z0-9_.-]+\.(?:sh|py|ts|tsx|mjs|js))[\"']\)"),
]
plist_pattern = re.compile(r"/Users/missioncontrol/opscenter-v2/opscenter/(scripts/[A-Za-z0-9_./-]+\.(?:sh|py|ts|tsx|mjs|js))")

for source in sources:
    try:
        text = source.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = source.read_text(encoding="utf-8", errors="replace")
    for match in absolute_patterns[0].finditer(text):
        references.add((source, match.group(1)))
    for match in absolute_patterns[1].finditer(text):
        references.add((source, f"{match.group(1)}/{match.group(2)}"))
    for match in plist_pattern.finditer(text):
        references.add((source, match.group(1)))

if not references:
    raise SystemExit("Collector reference integrity failed: no release-rooted collector script paths were discovered.")

missing = []
for source, relative in sorted(references, key=lambda item: (str(item[0]), item[1])):
    candidate = (release / relative).resolve()
    if release not in candidate.parents or not candidate.is_file():
        missing.append(f"{source}: {relative}")

if missing:
    print("Collector reference integrity failed; the immutable release is missing referenced scripts:", file=sys.stderr)
    for item in missing:
        print(f"- {item}", file=sys.stderr)
    raise SystemExit(1)

print(f"Collector reference integrity passed: {len(references)} release-rooted script references resolved.")
PY
