#!/usr/bin/env bash
# Offline checks for claude-review.sh. A stub `claude` records its arguments,
# environment and stdin; no real Claude Code, provider or network is used.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
script="$repo_root/claude-review.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/claude-review-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# The stub reads its behavior from files beside it, because claude-review.sh
# clears the environment before calling claude.
stub_dir="$work/bin"
mkdir -p "$stub_dir"
cat >"$stub_dir/claude" <<'STUB'
#!/usr/bin/env bash
dir="$(cd "$(dirname "$0")" && pwd)"
case "${1:-}" in
  --help) cat "$dir/help.txt"; exit 0 ;;
  auth) cat "$dir/auth.json"; exit 0 ;;
esac
printf '%s\n' "$@" >"$dir/args.txt"
env >"$dir/env.txt"
cat >"$dir/stdin.txt"
echo "stub review"
STUB
chmod +x "$stub_dir/claude"
flags="--restricted --safe-mode --strict-mcp-config --setting-sources --disable-slash-commands --permission-prompts --tools --disallowedTools"
write_help() {
  : >"$stub_dir/help.txt"
  for f in "$@"; do printf '  %s <x>   description\n' "$f" >>"$stub_dir/help.txt"; done
}
write_help $flags
subscription='{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"}'
printf '%s\n' "$subscription" >"$stub_dir/auth.json"

# A throwaway repository with a copy of the script and synthetic secrets.
repo="$work/repo"
mkdir -p "$repo"
cd "$repo"
git init -q
git config user.email test@example.invalid
git config user.name test
# Point the managed-settings locations at the test directory; the real ones
# are system paths this test must not touch.
sed -e "s|/etc/claude-code|$work/managed|; s|/Library/Application Support/ClaudeCode|$work/managed|" \
  -e "s|/Library/Managed Preferences|$work/managed-prefs|g" "$script" >./claude-review.sh
chmod +x ./claude-review.sh
export HOME="$work/home"
unset CLAUDE_CONFIG_DIR
mkdir -p "$HOME/.claude"
printf 'base\n' >app.ts
mkdir -p docs
printf 'Status:\n<!-- claude-review-extra-usage: confirmed-off -->\n' >docs/spending-controls.md
git add -A && git commit -q -m base
printf 'base\nchanged\n' >app.ts
printf 'export const x = 1\n' >new-file.ts
mkdir -p .claude nested/.aws
printf '//registry.example/:_authToken=SYNTH_NPMRC\n' >.npmrc
printf 'machine example password SYNTH_NETRC\n' >.netrc
printf '{"mcpServers":{"x":{"command":"SYNTH_MCP"}}}\n' >.mcp.json
printf '{"apiKeyHelper":"echo SYNTH_SETTINGS"}\n' >.claude/settings.json
printf 'A=SYNTH_ENV\n' >.env.Production
printf '[default]\nkey=SYNTH_AWS\n' >nested/.aws/credentials
printf 'SYNTH_PEM\n' >server.pem
printf 'name,SYNTH_CSV\n' >export.csv
printf 'TOKEN=SYNTH_DEVVARS\n' >.dev.vars
mkdir -p .auth ignored-data
printf '{"cookies":"SYNTH_AUTH_STATE"}\n' >.auth/state.json
mkdir -p 'ignored (private)' 'odd"	dir'
printf 'SYNTH_PAREN\n' >'ignored (private)/state.json'
printf 'SYNTH_ODD\n' >'odd"	dir/state.json'
printf '.auth/\nignored-data/\nignored (private)/\nodd*/\n' >.gitignore
printf 'SYNTH_IGNORED\n' >ignored-data/x.json

run() { PATH="$stub_dir:$PATH" "$@"; }

expect_exit() {
  local name="$1" want="$2"
  shift 2
  set +e
  run "$@" >/dev/null 2>&1
  local got=$?
  set -e
  check "$name (exit $want)" '[ "$got" = "$want" ]'
}
# Synthetic routing and key variables in the caller's environment.
export ANTHROPIC_API_KEY=SYNTH_API_KEY ANTHROPIC_AUTH_TOKEN=SYNTH_AUTH
export ANTHROPIC_BASE_URL=https://example.invalid CLAUDE_CODE_USE_FOUNDRY=1
export CLAUDE_CODE_USE_BEDROCK=1 CLAUDE_CODE_USE_VERTEX=1
export ANTHROPIC_FOUNDRY_API_KEY=SYNTH_FOUNDRY AWS_BEARER_TOKEN_BEDROCK=SYNTH_BEDROCK

out="$(run ./claude-review.sh "focus text" 2>"$work/stderr.txt")"
check "review runs on a subscription login" '[ "$out" = "stub review" ]'
check "changed tracked file is sent" 'grep -q "^+changed" "$stub_dir/stdin.txt"'
check "new untracked file is sent" 'grep -q "new-file.ts" "$stub_dir/stdin.txt"'
check "no synthetic secret reaches stdin" '! grep -q SYNTH "$stub_dir/stdin.txt"'
check "no synthetic secret is in the prompt" '! grep -q SYNTH "$stub_dir/args.txt"'
check "withheld files are listed on stderr" 'grep -q ".npmrc" "$work/stderr.txt" && grep -q ".claude/settings.json" "$work/stderr.txt"'
check "only allowlisted variables reach claude" '! cut -d= -f1 "$stub_dir/env.txt" | grep -v -x -E "HOME|PATH|USER|LOGNAME|SHELL|TMPDIR|TERM|LANG|CLAUDE_CONFIG_DIR|XDG_CONFIG_HOME|PWD|SHLVL|_|OLDPWD" | grep -q .'
for f in --restricted --safe-mode --strict-mcp-config --disable-slash-commands; do
  check "passes $f" 'grep -q -x -- "$f" "$stub_dir/args.txt"'
done
check "limits tools to Read, Grep, Glob" 'grep -A1 -x -- --tools "$stub_dir/args.txt" | grep -q -x "Read,Grep,Glob"'
check "loads no settings files" 'grep -A1 -x -- --setting-sources "$stub_dir/args.txt" | sed -n 2p | grep -q -x ""'
check "denies prompts" 'grep -A1 -x -- --permission-prompts "$stub_dir/args.txt" | grep -q -x none'
check "denies reading .npmrc" 'grep -q -x "Read(\*\*/.npmrc)" "$stub_dir/args.txt"'
check "denies reading gitignored paths" 'grep -q -x "Read(./.auth/\*\*)" "$stub_dir/args.txt" && grep -q -x "Read(./ignored-data/\*\*)" "$stub_dir/args.txt"'
check "caps turns" 'grep -A1 -x -- --max-turns "$stub_dir/args.txt" | grep -q -x 40'
check "denies ignored path with parentheses" 'grep -q -x "Read(./ignored ?private?/\*\*)" "$stub_dir/args.txt"'
check "denies ignored path with a quote and a tab" 'grep -q -x "Read(./odd??dir/\*\*)" "$stub_dir/args.txt"'
check "focus is in the prompt" 'grep -q "focus text" "$stub_dir/args.txt"'

# Committed secrets are withheld too.
git add -A && git commit -q -m secrets
printf 'B=SYNTH_ENV2\n' >>.env.Production
git rm -q --cached server.pem
printf 'ordinary change\n' >>app.ts
rm -f "$stub_dir/stdin.txt"
run ./claude-review.sh >/dev/null 2>&1 || true
check "tracked secret changes are withheld" '[ -s "$stub_dir/stdin.txt" ] && ! grep -q SYNTH "$stub_dir/stdin.txt"'
git reset -q --hard HEAD

# A secret renamed or copied to an ordinary name is refused, not sent.
git mv .npmrc renamed-npmrc.txt
rm -f "$stub_dir/args.txt"
expect_exit "renamed secret file" 6 ./claude-review.sh
check "renamed secret: review never called" '[ ! -e "$stub_dir/args.txt" ]'
git reset -q --hard HEAD
cp .netrc copied-netrc.txt
git add copied-netrc.txt
rm -f "$stub_dir/args.txt"
expect_exit "copied secret file" 6 ./claude-review.sh
check "copied secret: review never called" '[ ! -e "$stub_dir/args.txt" ]'
git reset -q --hard HEAD~1
printf 'another change\n' >>app.ts

fail_auth() {
  printf '%s\n' "$1" >"$stub_dir/auth.json"
  rm -f "$stub_dir/args.txt"
  expect_exit "$2" 5 ./claude-review.sh
  check "$2: claude review never called" '[ ! -e "$stub_dir/args.txt" ]'
}
fail_auth '{"loggedIn": false}' "not logged in"
fail_auth '{"loggedIn": true, "authMethod": "api_key", "apiProvider": "firstParty", "apiKeySource": "ANTHROPIC_API_KEY"}' "API key login"
fail_auth '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "apiKeySource": "apiKeyHelper"}' "apiKeyHelper"
fail_auth '{"loggedIn": true, "authMethod": "third_party", "apiProvider": "foundry"}' "Foundry provider"
fail_auth '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "bedrock"}' "Bedrock provider"
fail_auth 'not json' "unreadable auth status"
printf '%s\n' "$subscription" >"$stub_dir/auth.json"

managed_refusal() {
  rm -f "$stub_dir/args.txt"
  expect_exit "$1" 7 ./claude-review.sh
  check "$1: claude review never called" '[ ! -e "$stub_dir/args.txt" ]'
}
mkdir -p "$work/managed"
printf '{"hooks":{}}\n' >"$work/managed/managed-settings.json"
managed_refusal "managed settings file"
rm "$work/managed/managed-settings.json"
mkdir -p "$work/managed/managed-settings.d"
managed_refusal "managed settings drop-in"
rmdir "$work/managed/managed-settings.d"
printf '{}\n' >"$work/managed/managed-mcp.json"
managed_refusal "managed MCP file"
rm "$work/managed/managed-mcp.json"
mkdir -p "$work/managed-prefs"
: >"$work/managed-prefs/com.anthropic.claudecode.plist"
managed_refusal "MDM profile"
rm "$work/managed-prefs/com.anthropic.claudecode.plist"
printf '{"hooks":{"SessionStart":[]}}\n' >"$HOME/.claude/remote-settings.json"
managed_refusal "server-managed settings"
printf '{ }\n' >"$HOME/.claude/remote-settings.json"
rm -f "$stub_dir/args.txt"
run ./claude-review.sh >/dev/null 2>&1 || true
check "empty server-managed settings still run" '[ -e "$stub_dir/args.txt" ]'
rm "$HOME/.claude/remote-settings.json"

printf '%s\n' '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "team"}' >"$stub_dir/auth.json"
managed_refusal "Team plan"
printf '%s\n' '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "enterprise"}' >"$stub_dir/auth.json"
managed_refusal "Enterprise plan"
printf '%s\n' '{"loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty"}' >"$stub_dir/auth.json"
managed_refusal "unknown plan without a settings cache"
printf '{}\n' >"$HOME/.claude/remote-settings.json"
managed_refusal "unknown plan with an empty settings cache"
rm "$HOME/.claude/remote-settings.json"
printf '%s\n' "$subscription" >"$stub_dir/auth.json"
printf '%s\n' "$subscription" >"$stub_dir/auth.json"

# No review until the user has confirmed paid extra usage is off.
cp docs/spending-controls.md "$work/spending.md"
printf 'Status: pending\n' >docs/spending-controls.md
rm -f "$stub_dir/args.txt"
expect_exit "extra usage not confirmed" 8 ./claude-review.sh
check "extra usage not confirmed: review never called" '[ ! -e "$stub_dir/args.txt" ]'
cp "$work/spending.md" docs/spending-controls.md

write_help --restricted --tools
rm -f "$stub_dir/args.txt"
expect_exit "Claude Code without isolation flags" 4 ./claude-review.sh
check "old Claude Code: review never called" '[ ! -e "$stub_dir/args.txt" ]'
write_help $flags

CLAUDE_REVIEW_BASE=nope expect_exit "bad base" 2 ./claude-review.sh
CLAUDE_REVIEW_MAX_BYTES=10 expect_exit "oversize diff" 3 ./claude-review.sh
mkdir -p "$work/empty-bin"
ln -s "$(command -v git)" "$work/empty-bin/git"
expect_exit "claude not installed" 127 env PATH="$work/empty-bin:/usr/bin:/bin" ./claude-review.sh
git stash -q -u
expect_exit "no changes" 0 ./claude-review.sh
git stash pop -q

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all claude-review checks passed"
