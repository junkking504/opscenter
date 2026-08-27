#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
REMOTE="${OPSCENTER_VPS:-}"
REMOTE_ROOT="${OPSCENTER_REMOTE_ROOT:-/srv/opscenter}"
SSH_KEY="${OPSCENTER_SSH_KEY:-}"
SSH_ARGS=()
RSYNC_RSH="ssh"

if [[ -z "$REMOTE" ]]; then
  echo "Set OPSCENTER_VPS to the SSH destination, for example deploy@203.0.113.10." >&2
  exit 64
fi

if [[ -z "$REMOTE_ROOT" || "$REMOTE_ROOT" == "/" ]]; then
  echo "Refusing unsafe remote root: $REMOTE_ROOT" >&2
  exit 64
fi

if [[ -n "$SSH_KEY" ]]; then
  if [[ ! -f "$SSH_KEY" ]]; then
    echo "SSH key does not exist: $SSH_KEY" >&2
    exit 66
  fi
  SSH_ARGS=(-i "$SSH_KEY")
  printf -v RSYNC_RSH 'ssh -i %q' "$SSH_KEY"
fi

ssh "${SSH_ARGS[@]}" "$REMOTE" "mkdir -p '$REMOTE_ROOT/source'"

rsync -az -e "$RSYNC_RSH" --delete-delay --delay-updates \
  --exclude '.git/' \
  --exclude '.auth/' \
  --exclude '.next*/' \
  --exclude '.open-next/' \
  --exclude '.wrangler/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'artifacts/' \
  --exclude 'data' \
  --exclude 'junkware-*.png' \
  --exclude 'logs/' \
  --exclude 'tmp/' \
  --exclude 'playwright-report/' \
  --exclude 'test-results/' \
  --exclude 'tsconfig.tsbuildinfo' \
  --exclude '*.bak*' \
  --exclude '*.backup*' \
  "$PROJECT_ROOT/" "$REMOTE:$REMOTE_ROOT/source/"

# The Playwright runtime's pwuser is UID/GID 1001 and the VPS deployment user is
# UID/GID 1000. These directories are shared application state: the container
# writes them and the host pulls them back during the five-minute data sync.
ssh "${SSH_ARGS[@]}" "$REMOTE" "docker run --rm --user 0 \
  -v '$REMOTE_ROOT/data:/data' \
  --entrypoint /bin/sh node:22-bookworm-slim \
  -c 'state_dirs=\"/data/manual_bonuses /data/payroll_corrections /data/job-route-assignments /data/job-route-geocodes /data/searchkings-overrides /data/fleet /data/finance /data/job-call-ahead /data/integrations/junkware-sms /data/integrations/whatsapp-job-photos /data/integrations/whatsapp-crew-expenses\" && mkdir -p \$state_dirs && chown -R 1001:1000 \$state_dirs && find \$state_dirs -type d -exec chmod 2770 {} \; && find \$state_dirs -type f -exec chmod 0660 {} \;'"

ssh "${SSH_ARGS[@]}" "$REMOTE" "cd '$REMOTE_ROOT/source' && docker compose -f deploy/vps/compose.yaml up -d --build --remove-orphans"
ssh "${SSH_ARGS[@]}" "$REMOTE" "cd '$REMOTE_ROOT/source' && \
  container_id=\$(docker compose -f deploy/vps/compose.yaml ps -q opscenter) && \
  retry_container_id=\$(docker compose -f deploy/vps/compose.yaml ps -q assignment-retry) && \
  test -n \"\$container_id\" && \
  test -n \"\$retry_container_id\" && \
  ready=0 && \
  for attempt in \$(seq 1 45); do \
    health=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \"\$container_id\") && \
    if [ \"\$health\" = healthy ]; then ready=1; break; fi; \
    sleep 2; \
  done && \
  if [ \"\$ready\" != 1 ]; then \
    docker compose -f deploy/vps/compose.yaml ps; \
    docker compose -f deploy/vps/compose.yaml logs --tail=100 opscenter; \
    exit 1; \
  fi && \
  retry_state=\$(docker inspect --format '{{.State.Status}}' \"\$retry_container_id\") && \
  if [ \"\$retry_state\" != running ]; then \
    docker compose -f deploy/vps/compose.yaml logs --tail=100 assignment-retry; \
    echo \"Production assignment retry worker is not running.\" >&2; exit 1; \
  fi && \
  health_payload=\$(curl -fsS http://127.0.0.1:3000/api/health) && \
  case \"\$health_payload\" in \
    *'\"assignmentPersistence\":\"durable-local-first-v2\"'*'\"assignmentStoreWritable\":true'*) ;; \
    *) echo \"Production assignment persistence verification failed: \$health_payload\" >&2; exit 1 ;; \
  esac && \
  assignment_file='$REMOTE_ROOT/data/job-route-assignments/assignments.json' && \
  if [ -f \"\$assignment_file\" ] && [ ! -r \"\$assignment_file\" ]; then \
    echo \"Production assignment state is not readable by the host sync user.\" >&2; exit 1; \
  fi && \
  docker compose -f deploy/vps/compose.yaml ps && \
  echo \"Production health verified: \$health_payload\""
