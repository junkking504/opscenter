#!/bin/bash
set -euo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
MIN_AGE_MINUTES="${SEARCHKINGS_MIN_AGE_MINUTES:-15}"

cd "$OPSCENTER_DIR"
exec ./node_modules/.bin/tsx \
  scripts/collect-searchkings.ts \
  --data-dir "$OPSBOT_DIR/data" \
  --min-age-minutes "$MIN_AGE_MINUTES"
