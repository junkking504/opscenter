#!/bin/bash
set -euo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
ENV_FILE="${OPSCENTER_ENV_FILE:-$USER_HOME/Library/Application Support/OpsCenter/production.env}"
MIN_AGE_MINUTES="${PODIUM_REVIEWS_MIN_AGE_MINUTES:-15}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
if [[ -f "$OPSCENTER_DIR/scripts/load-opscenter-secrets.sh" ]]; then
  source "$OPSCENTER_DIR/scripts/load-opscenter-secrets.sh"
fi

cd "$OPSCENTER_DIR"
exec ./node_modules/.bin/tsx scripts/collect-podium-google-reviews.ts \
  --data-dir "$OPSBOT_DIR/data" \
  --min-age-minutes "$MIN_AGE_MINUTES"
