#!/bin/bash
# Build an exact source archive on the existing VPS, isolated from runtime memory.
# This command builds only; it does not deploy or promote a writer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[[ $# == 2 ]] || { echo 'Usage: build-continuity-image.sh <commit> <continuity-image-tag>' >&2; exit 64; }
REVISION="$(git -C "$ROOT" rev-parse --verify "$1^{commit}")"
IMAGE_TAG="$2"
[[ "$REVISION" =~ ^[a-f0-9]{40}$ && "$IMAGE_TAG" =~ ^opscenter:continuity-[a-zA-Z0-9_.-]+$ ]] || exit 64
SSH=(ssh -i /Users/missioncontrol/.ssh/id_ed25519_opscenter -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 opscenter@104.248.63.228)
# Hold the remote lock across the build and verify actual container limits.
# The default Docker backend may accept build flags without enforcing them.
git -C "$ROOT" archive "$REVISION" | "${SSH[@]}" bash -c "'set -euo pipefail
exec 9>/home/opscenter/continuity-monitor/build.lock
flock -n 9 || { echo \"Another continuity image build is running\" >&2; exit 1; }
BUILDER=opscenter-continuity-bounded
if ! docker buildx inspect \"\$BUILDER\" >/dev/null 2>&1; then
  docker buildx create --name \"\$BUILDER\" --driver docker-container --driver-opt memory=1792m --driver-opt memory-swap=1792m --driver-opt cpu-quota=100000 >/dev/null
fi
docker buildx inspect --bootstrap \"\$BUILDER\" >/dev/null
LIMITS=\$(docker inspect buildx_buildkit_opscenter-continuity-bounded0 --format \"{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuQuota}}\")
[ \"\$LIMITS\" = \"1879048192 1879048192 100000\" ] || { echo \"Build container limits are not verified\" >&2; exit 1; }
docker buildx build --builder \"\$BUILDER\" --load --progress=plain --label org.opencontainers.image.revision=$REVISION -t $IMAGE_TAG -f deploy/vps/Dockerfile -
ACTUAL=\$(docker image inspect $IMAGE_TAG --format \"{{index .Config.Labels \\\"org.opencontainers.image.revision\\\"}}\")
[ \"\$ACTUAL\" = \"$REVISION\" ] || { echo \"Built image revision mismatch\" >&2; exit 1; }
echo \"Verified image $IMAGE_TAG at $REVISION; deployment is a separate step.\"
'"
