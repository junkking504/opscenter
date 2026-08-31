#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPOSITORY_ROOT="${SCRIPT_DIR:h:h}"
PROGRAM_NAME="${0:t}"
MC_HOST="${OPSCENTER_MC_HOST:-}"
MC_SSH_KEY="${OPSCENTER_MC_SSH_KEY:-$HOME/.ssh/id_ed25519_opscenter}"
REQUESTED_REF="HEAD"
PRODUCTION_REMOTE_REF="refs/remotes/origin/production"

fail() {
  echo "MacBook controller installation stopped: $*" >&2
  exit 1
}

usage() {
  echo "usage: $PROGRAM_NAME <mc-host-or-address> [git-ref]" >&2
  echo "   or: OPSCENTER_MC_HOST=<host> $PROGRAM_NAME [git-ref]" >&2
  exit 64
}

if [[ -z "$MC_HOST" ]]; then
  [[ $# -ge 1 ]] || usage
  MC_HOST="$1"
  shift
fi
if [[ $# -ge 1 ]]; then
  REQUESTED_REF="$1"
  shift
fi
[[ $# -eq 0 ]] || usage

for command in git ssh; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

[[ -d "$REPOSITORY_ROOT/.git" ]] || fail "$REPOSITORY_ROOT is not a Git checkout"
[[ -f "$MC_SSH_KEY" ]] || fail "missing Mission Control SSH key: $MC_SSH_KEY"
git -C "$REPOSITORY_ROOT" fetch --prune origin
commit="$(git -C "$REPOSITORY_ROOT" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve local Git ref: $REQUESTED_REF"
production_commit="$(git -C "$REPOSITORY_ROOT" rev-parse --verify "${PRODUCTION_REMOTE_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$production_commit" ]] || fail "origin/production does not exist"
[[ "$commit" == "$production_commit" ]] \
  || fail "requested commit $commit is not the current origin/production commit $production_commit"

if [[ "$MC_HOST" == *@* ]]; then
  ssh_target="$MC_HOST"
else
  ssh_target="missioncontrol@$MC_HOST"
fi

ssh_options=(-i "$MC_SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)
echo "Installing the server-owned deployment controller from production commit $commit..."
git -C "$REPOSITORY_ROOT" show "${commit}:deploy/macmini/install-production-release-controller.sh" \
  | ssh "${ssh_options[@]}" "$ssh_target" /bin/zsh -s -- "$commit"
