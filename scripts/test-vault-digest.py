"""Exercise deploy/macmini/vault-nightly-digest.py against a throwaway workspace."""
import os
import pathlib
import subprocess
import sys
import tempfile
import time

DIGEST = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "macmini" / "vault-nightly-digest.py"


def write(path, text, age_hours=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    stamp = time.time() - age_hours * 3600
    os.utime(path, (stamp, stamp))


def run(workspace, *extra):
    return subprocess.run([sys.executable, str(DIGEST), "--workspace", str(workspace), "--date", "2026-10-17", *extra], capture_output=True, text=True)


with tempfile.TemporaryDirectory() as temp:
    workspace = pathlib.Path(temp)
    vault = workspace / "vault"
    assert run(workspace).returncode == 1, "no vault, no digest"

    write(vault / "Home.md", "# Home")
    (vault / "Inbox").mkdir()
    releases = workspace / "releases" / ("a" * 40)
    releases.mkdir(parents=True)
    (workspace / "opscenter").symlink_to(releases)
    write(vault / "Tasks" / "backup-fix" / "handoff.md", "# Handoff")
    write(vault / "Tasks" / "backup-fix" / "review.md", "# Review\n\n## Verdict\napprove\n")
    write(vault / "Tasks" / "slack-fix" / "handoff.md", "# Handoff")
    write(vault / "Tasks" / "old-task" / "handoff.md", "# Old", age_hours=72)
    write(vault / "Decisions" / "Backup target.md", "# Backup target")
    write(vault / "Decisions" / "README.md", "# Decisions")
    write(workspace / "task-evidence" / "backup-fix" / "verification.md", "secret-looking log line")

    # A git double records every call, so the digest provably stays offline.
    shim = workspace / "bin"
    shim.mkdir()
    (shim / "git").write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$GIT_CALLS"\nexit 1\n')
    (shim / "git").chmod(0o700)
    calls = workspace / "git-calls"
    env = {**os.environ, "PATH": f"{shim}:{os.environ['PATH']}", "GIT_CALLS": str(calls)}
    result = subprocess.run([sys.executable, str(DIGEST), "--workspace", str(workspace), "--date", "2026-10-17"], capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    recorded = calls.read_text()
    assert "log" in recorded and not any(word in recorded for word in ("fetch", "pull", "ls-remote", "push")), recorded
    text = (vault / "Inbox" / "Digest 2026-10-17.md").read_text()
    assert "Active release: `aaaaaaaaaaaa`" in text
    assert "[[Tasks/backup-fix/review]]: approve" in text
    assert "[[Tasks/slack-fix/handoff]] has a handoff but no review.md" in text
    assert "backup-fix/handoff]] has a handoff" not in text
    assert "old-task" not in text, "older notes are left out"
    assert "[[Decisions/Backup target]]" in text and "Decisions/README" not in text
    assert "`task-evidence/backup-fix/verification.md`" in text
    assert "secret-looking" not in text, "contents are linked, never copied"
    assert "No new production commits." in text, "a missing repository is reported, not fatal"

    write(vault / "Inbox" / "Digest 2026-10-17.md", "edited by a person")
    assert "skipped" in run(workspace).stdout
    assert (vault / "Inbox" / "Digest 2026-10-17.md").read_text() == "edited by a person", "an existing digest is not overwritten"
    assert run(workspace, "--force").returncode == 0
    assert "edited by a person" not in (vault / "Inbox" / "Digest 2026-10-17.md").read_text()

print("Vault digest passed: no network Git calls, missing vault, active release, reviews and verdicts, unreviewed handoffs, time window, README exclusion, links not contents, and no overwrite without --force.")
