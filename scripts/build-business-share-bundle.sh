#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
repo_dir="${script_dir:h}"
output_root="${OPSCENTER_SHARE_OUTPUT_ROOT:-/Users/missioncontrol/opscenter-v2/business-share-output}"
timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
commit_sha="$(git -C "$repo_dir" rev-parse HEAD)"
short_sha="$(git -C "$repo_dir" rev-parse --short=12 HEAD)"
bundle_dir="$output_root/OpsCenter-Business-$timestamp-$short_sha"
readable_dir="$bundle_dir/readable-context"

if ! git -C "$repo_dir" diff --quiet -- ||
   ! git -C "$repo_dir" diff --cached --quiet --; then
  print -u2 "Refusing to build from a dirty checkout. Commit or stash the intended changes first."
  exit 1
fi

tracked_sensitive="$(
  git -C "$repo_dir" ls-files |
    awk '
      /(^|\/)\.env($|\.)/ && !/\.example$/ { print }
      /^(data|logs|tmp|\.auth)(\/|$)/ { print }
      /(^|\/)(node_modules|\.next|\.wrangler)(\/|$)/ { print }
    '
)"

if [[ -n "$tracked_sensitive" ]]; then
  print -u2 "Refusing to build: sensitive or runtime paths are tracked:"
  print -u2 -- "$tracked_sensitive"
  exit 1
fi

private_key_files="$(
  git -C "$repo_dir" grep -Il -E -- 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' HEAD -- 2>/dev/null || true
)"

if [[ -n "$private_key_files" ]]; then
  print -u2 "Refusing to build: private-key material was detected:"
  print -u2 -- "$private_key_files"
  exit 1
fi

high_confidence_token_files="$(
  git -C "$repo_dir" grep -Il -E -- \
    'xox[baprs]-[0-9]{8,}-[0-9A-Za-z-]{10,}|sk-proj-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}' \
    HEAD -- 2>/dev/null || true
)"

if [[ -n "$high_confidence_token_files" ]]; then
  print -u2 "Refusing to build: likely credential material was detected:"
  print -u2 -- "$high_confidence_token_files"
  exit 1
fi

mkdir -p "$readable_dir/docs/adr"

cp "$repo_dir/README.md" "$readable_dir/"
cp "$repo_dir/OPSCENTER_V2_SPEC.md" "$readable_dir/"
cp "$repo_dir/business-share/README.md" "$readable_dir/BUSINESS_SHARE_README.md"
cp "$repo_dir/business-share/PROJECT_INSTRUCTIONS.md" "$readable_dir/"
cp "$repo_dir/business-share/OpsCenter-Business-Context.md" "$readable_dir/"

for doc_name in \
  Home.md \
  ASSET_REGISTER.md \
  EDITING_AND_RELEASES.md \
  SHARING_AND_ACCESS.md \
  CONTEXT_AND_HISTORY.md \
  OPSCENTER_OS_CONSTITUTION.md \
  PLATFORM_KERNEL_ARCHITECTURE.md \
  OPERATING_INBOX_VERTICAL_SLICE.md \
  crew-pay-portal.md \
  payment-reconciliation.md \
  qbo-intuit-production-setup.md \
  searchkings-integration.md \
  slack-opscenter.md \
  whatsapp-job-photos.md; do
  cp "$repo_dir/docs/$doc_name" "$readable_dir/docs/$doc_name"
done

cp "$repo_dir/docs/adr/0001-platform-store-postgresql.md" "$readable_dir/docs/adr/"

git -C "$repo_dir" archive \
  --format=zip \
  --output="$bundle_dir/OpsCenter-source-$short_sha.zip" \
  "$commit_sha"

readable_count="$(find "$readable_dir" -type f | wc -l | tr -d '[:space:]')"
source_checksum="$(shasum -a 256 "$bundle_dir/OpsCenter-source-$short_sha.zip" | awk '{print $1}')"

{
  print "OpsCenter Business Share Bundle"
  print "Generated UTC: $timestamp"
  print "Source commit: $commit_sha"
  print "Readable files: $readable_count"
  print "Source archive SHA-256: $source_checksum"
  print
  print "Included: reviewed Git-tracked source plus curated readable context."
  print "Excluded: external OpsBot runtime, data, credentials, environment files, logs, browser state, databases, releases, previews, worktrees, caches, and backups."
  print
  print "Review every file before upload. Use readable-context for the ChatGPT Business project and the private Git repository for editing."
} > "$bundle_dir/MANIFEST.txt"

if (( readable_count > 40 )); then
  print -u2 "Refusing to finish: readable file count $readable_count exceeds the Business project target of 40."
  exit 1
fi

print -- "$bundle_dir"
