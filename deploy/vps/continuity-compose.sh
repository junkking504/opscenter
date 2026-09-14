#!/usr/bin/env bash
# Run Compose with the existing Docker authority without exposing protected env files.
set -euo pipefail
ROOT=/srv/opscenter/continuity-20260912
exec docker run --rm --network none \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker:ro \
  -v /usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro \
  -v "$ROOT:$ROOT:ro" \
  -v /etc/opscenter/continuity-app.env:/etc/opscenter/continuity-app.env:ro \
  -v /etc/opscenter/continuity-database.env:/etc/opscenter/continuity-database.env:ro \
  -v /etc/opscenter/continuity-auth-egress.env:/etc/opscenter/continuity-auth-egress.env:ro \
  node:22-bookworm-slim docker compose -f "$ROOT/compose.yaml" "$@"
