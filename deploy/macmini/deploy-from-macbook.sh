#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPOSITORY_ROOT="${SCRIPT_DIR:h:h}"
PROGRAM_NAME="${0:t}"
BOOTSTRAP=false
ALLOW_NON_FORWARD=false
MC_HOST="${OPSCENTER_MC_HOST:-}"
MC_SSH_KEY="${OPSCENTER_MC_SSH_KEY:-$HOME/.ssh/id_ed25519_opscenter}"
REQUESTED_REF="HEAD"

fail() {
  echo "MacBook deployment stopped: $*" >&2
  exit 1
}

usage() {
  echo "usage: $PROGRAM_NAME [--bootstrap] [--allow-non-forward] <mc-host-or-address> [git-ref]" >&2
  echo "   or: OPSCENTER_MC_HOST=<host> $PROGRAM_NAME [--bootstrap] [--allow-non-forward] [git-ref]" >&2
  exit 64
}

while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --bootstrap)
      BOOTSTRAP=true
      ;;
    --allow-non-forward)
      ALLOW_NON_FORWARD=true
      ;;
    *)
      usage
      ;;
  esac
  shift
done

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

[[ "$(git -C "$REPOSITORY_ROOT" rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]] \
  || fail "$REPOSITORY_ROOT is not a Git checkout"
[[ -f "$MC_SSH_KEY" ]] || fail "missing Mission Control SSH key: $MC_SSH_KEY"
commit="$(git -C "$REPOSITORY_ROOT" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve local Git ref: $REQUESTED_REF"

remote_containers="$(git -C "$REPOSITORY_ROOT" for-each-ref --format='%(refname)' --contains "$commit" refs/remotes/origin)"
[[ -n "$remote_containers" ]] || fail "commit $commit is not present in a known origin branch; push it first"

if [[ -n "$(git -C "$REPOSITORY_ROOT" status --short)" ]]; then
  echo "Note: uncommitted MacBook changes are not part of this deployment."
fi

repository_url="$(git -C "$REPOSITORY_ROOT" remote get-url origin)"
[[ -n "$repository_url" ]] || fail "the local checkout has no origin URL"

if [[ "$MC_HOST" == *@* ]]; then
  ssh_target="$MC_HOST"
else
  ssh_target="missioncontrol@$MC_HOST"
fi

ssh_options=(-i "$MC_SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)
ssh "${ssh_options[@]}" "$ssh_target" /usr/bin/true

# Preserve an explicit request to leave the separately managed photo worker
# running when the remote release script is invoked over SSH.
remote_environment=()
if [[ -n "${OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER+x}" ]]; then
  remote_environment=(env "OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER=$OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER")
fi

if $BOOTSTRAP; then
  echo "Preparing the Mission Control Git release layout..."
  ssh "${ssh_options[@]}" "$ssh_target" /bin/zsh -s -- "$repository_url" \
    < "$SCRIPT_DIR/bootstrap-git-deployment.sh"
fi

echo "Deploying pushed commit $commit to Mission Control..."
allow_non_forward_arg=0
if $ALLOW_NON_FORWARD; then
  allow_non_forward_arg=1
fi
ssh "${ssh_options[@]}" "$ssh_target" "${remote_environment[@]}" /bin/zsh -s -- "$commit" \
  "$allow_non_forward_arg" \
  < "$SCRIPT_DIR/deploy-release.sh"
