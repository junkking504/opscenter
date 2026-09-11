#!/bin/zsh
set -euo pipefail

WORKDIR="/Users/missioncontrol/.openclaw/workspace"
OPENCLAW="/Users/missioncontrol/.npm-global/bin/openclaw"
LOGDIR="$WORKDIR/opsbot/data/logs"
LOGFILE="$LOGDIR/browser_keepalive.log"
STATEFILE="$LOGDIR/browser_keepalive_tabs.env"
LOCKDIR="$LOGDIR/browser_keepalive.lock"
GATEWAY_PLIST="/Users/missioncontrol/Library/LaunchAgents/ai.openclaw.gateway.plist"
JUNKWARE_AUTH_CHECK="$WORKDIR/opsbot/scripts/collect_junkware_daily.py"

JUNK_SCHEDULE_URL="https://junkware.junk-king.com/franchise/schedule.aspx"
JUNK_TRUCK_URL="https://junkware.junk-king.com/franchise/accounting/truck-records.aspx"

export PATH="/usr/local/bin:/opt/homebrew/bin:/Users/missioncontrol/.npm-global/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOGDIR"

log() {
  print -u2 -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  log "FAILED: $*"
  exit 1
}

cleanup() {
  rmdir "$LOCKDIR" 2>/dev/null || true
}

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  log "another keepalive run is already active; skipping"
  exit 0
fi
trap cleanup EXIT INT TERM

load_state() {
  JUNK_TAB_ID=""

  if [[ ! -f "$STATEFILE" ]]; then
    return 0
  fi

  local line_count state_line
  line_count="$(wc -l < "$STATEFILE" | tr -d ' ')"
  state_line="$(sed -n '1p' "$STATEFILE")"

  if [[ "$line_count" != "1" || ! "$state_line" =~ '^JUNK_TAB_ID=[[:alnum:]_-]+$' ]]; then
    log "ignoring malformed state file: $STATEFILE"
    return 0
  fi

  JUNK_TAB_ID="${state_line#JUNK_TAB_ID=}"
}

RUN_OUTPUT=""
run_cmd() {
  local rc

  log "+ $*"
  set +e
  RUN_OUTPUT="$("$@" 2>&1)"
  rc=$?
  set -e

  if [[ -n "$RUN_OUTPUT" ]]; then
    print -u2 -r -- "$RUN_OUTPUT"
  fi

  if (( rc != 0 )); then
    log "command failed with status $rc: $*"
    return "$rc"
  fi

  return 0
}

run_browser() {
  run_cmd "$OPENCLAW" browser --browser-profile openclaw "$@"
}

ensure_gateway() {
  local uid

  uid="$(id -u)"

  # A keepalive must not terminate healthy browser sessions or in-flight exports.
  if run_cmd "$OPENCLAW" gateway status --require-rpc --timeout 5000; then
    return 0
  fi

  if run_cmd launchctl kickstart "gui/$uid/ai.openclaw.gateway"; then
    return 0
  fi

  if [[ -f "$GATEWAY_PLIST" ]]; then
    run_cmd launchctl bootstrap "gui/$uid" "$GATEWAY_PLIST" || return 1
    run_cmd launchctl kickstart "gui/$uid/ai.openclaw.gateway" || return 1
  fi
}

ensure_junkware_collector_session() {
  # The OpenClaw browser profile is useful for keeping a tab warm, but it is
  # not the protected Playwright session that OpsCenter collectors and the
  # WhatsApp photo uploader use. Exercise the authoritative session instead:
  # it reuses the protected storage state or signs in from Keychain, then
  # persists the renewed state for every later collector/upload operation.
  run_cmd /usr/bin/python3 "$JUNKWARE_AUTH_CHECK" --auth-check
}

ensure_tab() {
  local current="$1"
  local url="$2"
  local output tab

  if [[ -n "${current:-}" ]] && run_browser focus "$current"; then
    print -r -- "$current"
    return 0
  fi

  if [[ -n "${current:-}" ]]; then
    log "stored tab $current is stale; opening a replacement"
  fi

  run_browser open "$url" || return 1
  output="$RUN_OUTPUT"
  tab=$(print -r -- "$output" | awk -F': ' '/^tab:/ {print $2; exit}')
  if [[ -z "$tab" ]]; then
    tab=$(print -r -- "$output" | sed -nE 's/.*"tab"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)
  fi

  if [[ -z "$tab" ]]; then
    log "failed to parse tab id after opening $url"
    return 1
  fi

  print -r -- "$tab"
}

{
  log "keepalive start"
  load_state

  ensure_gateway || die "OpenClaw gateway is not available"
  ensure_junkware_collector_session || die "JunkWare collector authentication could not be refreshed"
  run_browser start --headless || die "OpenClaw browser did not start"

  JUNK_TAB_ID="$(ensure_tab "${JUNK_TAB_ID:-}" "$JUNK_SCHEDULE_URL")"

  run_browser focus "$JUNK_TAB_ID" || die "could not focus $JUNK_TAB_ID"
  run_browser navigate "$JUNK_SCHEDULE_URL" --target-id "$JUNK_TAB_ID" || die "could not navigate schedule page"
  run_browser navigate "$JUNK_TRUCK_URL" --target-id "$JUNK_TAB_ID" || die "could not navigate truck-record page"

  {
    print -r -- "JUNK_TAB_ID=$JUNK_TAB_ID"
  } > "$STATEFILE"

  log "keepalive done"
} >> "$LOGFILE" 2>&1
