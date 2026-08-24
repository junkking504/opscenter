#!/bin/bash
# Shared collector guard. It records sanitized source outcomes durably so the
# Slack data-health publisher can alert before stale snapshots become visible.

set -u

OPS_COLLECTOR_HEALTH_FILE="${OPSCENTER_COLLECTOR_HEALTH_FILE:-${OPSBOT_DATA_DIR:-${HOME:?HOME must be set}/.openclaw/workspace/opsbot/data}/health/collector_failures.json}"
COLLECTOR_FAILURE_ESCALATION_THRESHOLD="${COLLECTOR_FAILURE_ESCALATION_THRESHOLD:-5}"

collector_release_commit() {
  if [ -n "${OPSCENTER_RELEASE_COMMIT:-}" ]; then
    printf '%s\n' "$OPSCENTER_RELEASE_COMMIT"
    return 0
  fi
  if [ -n "${OPSCENTER_DIR:-}" ] && [ -d "$OPSCENTER_DIR/.git" -o -f "$OPSCENTER_DIR/.git" ]; then
    /usr/bin/git -C "$OPSCENTER_DIR" rev-parse HEAD 2>/dev/null || true
  fi
}

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
  local release_commit
  release_commit="$(collector_release_commit)"
  OPS_COLLECTOR_HEALTH_FILE="$OPS_COLLECTOR_HEALTH_FILE" \
  OPS_COLLECTOR_SOURCE="$source" \
  OPS_COLLECTOR_STATUS="$status" \
  OPS_COLLECTOR_ERROR="$error" \
  OPS_COLLECTOR_RELEASE_COMMIT="$release_commit" \
  OPS_COLLECTOR_FAILURE_ESCALATION_THRESHOLD="$COLLECTOR_FAILURE_ESCALATION_THRESHOLD" \
  /usr/bin/python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

path = Path(os.environ["OPS_COLLECTOR_HEALTH_FILE"])
source = os.environ["OPS_COLLECTOR_SOURCE"]
status = os.environ["OPS_COLLECTOR_STATUS"]
error = os.environ.get("OPS_COLLECTOR_ERROR", "")[:240]
release_commit = os.environ.get("OPS_COLLECTOR_RELEASE_COMMIT", "")[:64]
threshold = max(1, int(os.environ.get("OPS_COLLECTOR_FAILURE_ESCALATION_THRESHOLD", "5")))
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
try:
    state = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    state = {"version": 2, "conditions": [], "last_successes": {}}
conditions = [item for item in state.get("conditions", []) if isinstance(item, dict)]
existing = next((item for item in conditions if item.get("id") == source), None)
conditions = [item for item in conditions if item.get("id") != source]
successes = state.get("last_successes") if isinstance(state.get("last_successes"), dict) else {}
if status == "failed":
    count = int(existing.get("consecutive_failures") or 0) + 1 if existing else 1
    conditions.append({
        "id": source,
        "source": source.replace("_", " ").title(),
        "first_failed_at": existing.get("first_failed_at", now) if existing else now,
        "failed_at": now,
        "consecutive_failures": count,
        "escalated": count >= threshold,
        "error": error,
        "release_commit": release_commit,
    })
elif status == "succeeded":
    successes[source] = {"succeeded_at": now, "release_commit": release_commit}
state = {
    "version": 2,
    "updated_at": now,
    "conditions": conditions,
    "last_successes": successes,
}
path.parent.mkdir(parents=True, exist_ok=True)
temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
temporary.replace(path)
PY
}

collector_failure_recorded_since() {
  local since_epoch="${1:?start epoch is required}"
  OPS_COLLECTOR_HEALTH_FILE="$OPS_COLLECTOR_HEALTH_FILE" \
  OPS_COLLECTOR_SINCE_EPOCH="$since_epoch" \
  /usr/bin/python3 - <<'PY'
import json
import os
from datetime import datetime
from pathlib import Path

try:
    state = json.loads(Path(os.environ["OPS_COLLECTOR_HEALTH_FILE"]).read_text(encoding="utf-8"))
    since = float(os.environ["OPS_COLLECTOR_SINCE_EPOCH"])
    for item in state.get("conditions", []):
        value = str(item.get("failed_at") or "").replace("Z", "+00:00")
        if value and datetime.fromisoformat(value).timestamp() >= since:
            raise SystemExit(0)
except SystemExit:
    raise
except Exception:
    pass
raise SystemExit(1)
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
    /bin/rm -f "$output"
    echo "$source collection deferred: $dns_error" >&2
    return 1
  fi

  if [ "${DATA_COLLECTION_STUB:-0}" = "1" ]; then
    update_collector_health "$source" succeeded
    /bin/rm -f "$output"
    echo "$source collection stubbed."
    return 0
  fi

  if "$@" >"$output" 2>&1; then
    /bin/cat "$output"
    update_collector_health "$source" succeeded
    /bin/rm -f "$output"
    return 0
  fi
  local error
  error="$(sanitize_collector_error "$output")"
  update_collector_health "$source" failed "$error"
  /bin/rm -f "$output"
  echo "$source collection failed: $error" >&2
  return 1
}

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  OPSCENTER_RELEASE_COMMIT="$(collector_release_commit)"
  export OPSCENTER_RELEASE_COMMIT
  echo "OPSCENTER_COLLECTOR_RELEASE=${OPSCENTER_RELEASE_COMMIT:-unknown}"
fi
