#!/bin/bash
# Shared collector guard. A failed source is recorded durably so the current
# refresh cycle can alert it, while the outer refresh loop supplies the
# 10/20/40/60-second retry cadence.

set -u

OPS_COLLECTOR_HEALTH_FILE="${OPSCENTER_COLLECTOR_HEALTH_FILE:-${OPSBOT_DATA_DIR:-${HOME:?HOME must be set}/.openclaw/workspace/opsbot/data}/health/collector_failures.json}"

assert_dns_answer() {
  local host="${1:?source host is required}"
  local answers
  answers="$(/usr/bin/dig +short A "$host" 2>/dev/null; /usr/bin/dig +short AAAA "$host" 2>/dev/null)"
  if [ -z "$(printf '%s' "$answers" | /usr/bin/awk 'NF { found=1 } END { if (found) print "yes" }')" ]; then
    echo "DNS did not return an address for $host." >&2
    return 1
  fi
}

sanitize_collector_error() {
  local file="${1:?error file is required}"
  /usr/bin/python3 - "$file" <<'PY'
import re
import sys
from pathlib import Path

try:
    line = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines()[0]
except Exception:
    line = "External-source request failed."
line = re.sub(r"<[^>]*>", " ", line)
line = re.sub(r"https?://[^\s?#]+\?\S*", "[redacted URL]", line, flags=re.I)
line = re.sub(r"\b(authorization|cookie|set-cookie|token|password|secret)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", line, flags=re.I)
line = re.sub(r"\s+", " ", line).strip() or "External-source request failed."
print(line[:239] + ("…" if len(line) > 240 else ""))
PY
}

update_collector_health() {
  local source="${1:?source is required}"
  local status="${2:?status is required}"
  local error="${3:-}"
  OPS_COLLECTOR_HEALTH_FILE="$OPS_COLLECTOR_HEALTH_FILE" \
  OPS_COLLECTOR_SOURCE="$source" \
  OPS_COLLECTOR_STATUS="$status" \
  OPS_COLLECTOR_ERROR="$error" \
  /usr/bin/python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

path = Path(os.environ["OPS_COLLECTOR_HEALTH_FILE"])
source = os.environ["OPS_COLLECTOR_SOURCE"]
status = os.environ["OPS_COLLECTOR_STATUS"]
error = os.environ.get("OPS_COLLECTOR_ERROR", "")[:240]
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
try:
    state = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    state = {"version": 1, "conditions": []}
conditions = [item for item in state.get("conditions", []) if isinstance(item, dict) and item.get("id") != source]
if status == "failed":
    conditions.append({"id": source, "source": source.replace("_", " ").title(), "failed_at": now, "error": error})
state = {"version": 1, "updated_at": now, "conditions": conditions}
path.parent.mkdir(parents=True, exist_ok=True)
temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
temporary.replace(path)
PY
}

run_hardened_source() {
  local source="${1:?source id is required}"
  local host="${2:?source host is required}"
  shift 2
  local output
  output="$(/usr/bin/mktemp -t "opscenter-${source}.XXXXXX")" || return 1
  /bin/chmod 600 "$output"

  if ! assert_dns_answer "$host" >"$output" 2>&1; then
    local dns_error
    dns_error="$(sanitize_collector_error "$output")"
    update_collector_health "$source" failed "$dns_error"
    rm -f "$output"
    echo "$source collection deferred: $dns_error" >&2
    return 1
  fi

  if [ "${DATA_COLLECTION_STUB:-0}" = "1" ]; then
    update_collector_health "$source" succeeded
    rm -f "$output"
    echo "$source collection stubbed."
    return 0
  fi

  if "$@" >"$output" 2>&1; then
    /bin/cat "$output"
    update_collector_health "$source" succeeded
    rm -f "$output"
    return 0
  fi
  local error
  error="$(sanitize_collector_error "$output")"
  update_collector_health "$source" failed "$error"
  rm -f "$output"
  echo "$source collection failed: $error" >&2
  return 1
}
