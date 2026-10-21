"""Exercise deploy/macmini/handoff-relay.py with stand-in codex and claude commands in a throwaway workspace."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

RELAY = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "macmini" / "handoff-relay.py"

# Stand-ins record their arguments and environment, then do what the real agent would to the task files.
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, re, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["STUB_CALLS"], "a") as fh:
    fh.write(json.dumps({"tool": name, "args": args, "api_key": "ANTHROPIC_API_KEY" in os.environ, "cwd": os.getcwd()}) + "\n")
if os.environ.get("STUB_SLEEP"):
    time.sleep(int(os.environ["STUB_SLEEP"]))
prompt = args[-1] if name == "codex" else args[args.index("-p") + 1]
vault = pathlib.Path(re.search(r"(/\S+/vault/Tasks/[^/\s]+)", prompt).group(1))
task = vault.name
work = vault.parent.parent.parent / "worktrees" / task
def git(*a):
    return subprocess.run(["git", "-C", str(work), *a], capture_output=True, text=True, check=True).stdout.strip()
def commit(label):
    (work / os.environ.get("STUB_FILE", "lib/feature.ts")).parent.mkdir(parents=True, exist_ok=True)
    with open(work / os.environ.get("STUB_FILE", "lib/feature.ts"), "a") as fh:
        fh.write(label + "\n")
    git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", label)
    return git("rev-parse", "HEAD")
if prompt.startswith("Build"):
    sha = commit("build")
    (vault / "handoff.md").write_text(f"# Handoff: {task}\n\nBuilder: Codex  ·  Branch: codex/{task} @ {sha}  ·  Base: origin/production @ x\n")
elif prompt.startswith("Fix"):
    sha = commit("fix")
    with open(vault / "handoff.md", "a") as fh:
        fh.write(f"\n## Update\n\nBuilder: Codex  ·  Branch: codex/{task} @ {sha}  ·  Base: origin/production @ x\n")
else:
    head = re.findall(r"@ ([0-9a-f]{40})", (vault / "handoff.md").read_text())[-1]
    who = "Claude" if name == "claude" else "Codex"
    builder = "Codex" if who == "Claude" else "Claude"
    (vault / "review.md").write_text(f"# Review: {task}\n\nReviewer: {who}  ·  Builder: {builder}  ·  Reviewed: b @ {head}\n\n## Verdict\n{os.environ.get('STUB_VERDICT', 'approve')}\n")
'''


def run(env, *args):
    return subprocess.run([sys.executable, str(RELAY), "--root", str(root), *args], capture_output=True, text=True, env=env)


def wait_idle(timeout=30):
    end = time.time() + timeout
    while (root / "task-evidence" / "handoff-relay" / "lock").exists():
        assert time.time() < end, "step did not finish"
        time.sleep(0.1)


def calls():
    path = root / "stub-calls"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def state(task):
    return json.loads((root / "task-evidence" / "handoff-relay" / "state" / f"{task}.json").read_text())


def brief(task, auto="Auto: codex-build", questions="None"):
    folder = root / "vault" / "Tasks" / task
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "brief.md").write_text(f"# Brief: {task}\n\nPlanner: Claude\n{auto}\n\n## Goal\nx\n\n## Open questions\n- {questions}\n")
    time.sleep(0.02)  # tasks are taken oldest brief first


def sh(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp) / "opscenter-v2"
    (root / "vault" / "Tasks").mkdir(parents=True)
    (root / "worktrees").mkdir()
    origin = pathlib.Path(temp) / "origin.git"
    sh("git", "init", "-q", "--bare", "-b", "production", str(origin))
    seed = pathlib.Path(temp) / "seed"
    sh("git", "init", "-q", "-b", "production", str(seed))
    (seed / "README.md").write_text("base\n")
    sh("git", "add", "-A", cwd=seed)
    sh("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base", cwd=seed)
    sh("git", "push", "-q", str(origin), "production", cwd=seed)
    sh("git", "clone", "-q", "-b", "production", str(origin), str(root / "repository"))

    bin_dir = pathlib.Path(temp) / "bin"
    bin_dir.mkdir()
    for name in ("codex", "claude"):
        (bin_dir / name).write_text(STUB)
        (bin_dir / name).chmod(0o700)
    env = {**os.environ, "STUB_CALLS": str(root / "stub-calls"), "RELAY_CODEX_BIN": str(bin_dir / "codex"),
           "RELAY_CLAUDE_BIN": str(bin_dir / "claude"), "ANTHROPIC_API_KEY": "must-not-reach-claude",
           "STUB_VERDICT": "changes requested"}
    evidence = root / "task-evidence" / "handoff-relay"

    brief("manual-task", auto="")
    brief("loop-task")

    # Off by default: no switch file, nothing happens and nothing is written.
    assert run(env).returncode == 0 and not evidence.exists() and not calls()

    # Dry run reports the next step but writes and launches nothing.
    dry = run(env, "--dry-run")
    assert dry.returncode == 0 and "loop-task: start build" in dry.stdout, dry.stdout
    assert "manual-task" not in dry.stdout, "tasks without an Auto line are ignored"
    assert not evidence.exists() and not calls() and not (root / "vault/Tasks/loop-task/relay.md").exists()

    # Live: build, then Claude review / Codex fix rounds until the loop limit.
    (root / "vault" / "Tasks" / ".relay-on").write_text("")
    for _ in range(8):
        assert run(env).returncode == 0
        wait_idle()
    tools = [c["tool"] for c in calls()]
    assert tools == ["codex", "claude", "codex", "claude", "codex", "claude"], tools
    assert "loop limit" in (root / "vault/Tasks/loop-task/relay.md").read_text()
    assert "needs T'Jean" in (root / "vault/Tasks/loop-task/relay.md").read_text()
    assert subprocess.run(["git", "-C", str(root / "worktrees/loop-task"), "branch", "--show-current"],
                          capture_output=True, text=True).stdout.strip() == "codex/loop-task"
    claude_calls = [c for c in calls() if c["tool"] == "claude"]
    assert not any(c["api_key"] for c in claude_calls), "API key is scrubbed before Claude runs"
    assert all(c["args"][c["args"].index("--model") + 1] == "sonnet" for c in claude_calls)
    allowed = claude_calls[0]["args"][claude_calls[0]["args"].index("--allowedTools") + 1]
    assert "Write(//" in allowed and allowed.count("review.md") == 2 and "Bash(git push" not in allowed
    assert "Bash(git push:*)" in claude_calls[0]["args"][claude_calls[0]["args"].index("--disallowedTools") + 1]
    codex_build = calls()[0]["args"]
    assert codex_build[:6] == ["exec", "-C", str(root / "worktrees/loop-task"), "-s", "workspace-write", "--approve-for-me"]
    log = (evidence / "relay.log").read_text()
    assert log.count("loop-task: start") == 6 and "loop-task: needs-user (loop limit" in log
    assert log.count("loop-task: needs-user") == 1, "a resting state is logged once, not every tick"

    # Daily cap: six runs happened today, so the next task waits for tomorrow.
    brief("approve-task")
    assert "daily cap" in run(env).stdout and len(calls()) == 6
    (evidence / "runs.json").write_text("{}")

    # Approved: the relay stops and hands the task to the user; sensitive paths get Opus.
    env_ok = {**env, "STUB_VERDICT": "approve", "STUB_FILE": "lib/payroll/run.ts"}
    for _ in range(3):
        run(env_ok)
        wait_idle()
    assert "ready for T'Jean" in (root / "vault/Tasks/approve-task/relay.md").read_text()
    review = [c for c in calls() if c["tool"] == "claude"][-1]
    assert review["args"][review["args"].index("--model") + 1] == "opus"
    assert len(calls()) == 8

    # A Claude-built branch is reviewed by Codex, inside the vault folder; changes go back to the Claude thread.
    brief("claude-built", auto="Auto: review")
    run(env)
    assert "waiting" in (root / "vault/Tasks/claude-built/relay.md").read_text() and len(calls()) == 8
    sh("git", "-C", str(root / "repository"), "worktree", "add", "-q", "-b", "claude/x", str(root / "worktrees/claude-built"), "origin/production")
    head = subprocess.run(["git", "-C", str(root / "worktrees/claude-built"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    (root / "vault/Tasks/claude-built/handoff.md").write_text(f"# Handoff\n\nBuilder: Claude  ·  Branch: claude/x @ {head}  ·  Base: x\n")
    for _ in range(2):
        run(env)
        wait_idle()
    assert calls()[-1]["tool"] == "codex" and calls()[-1]["cwd"] == str(root / "vault/Tasks/claude-built")
    assert "waiting for Claude thread" in (root / "vault/Tasks/claude-built/relay.md").read_text()

    # Open questions in the brief stop the relay before anything runs.
    brief("unclear-task", questions="Which crews are in scope?")
    run(env)
    assert "open questions" in (root / "vault/Tasks/unclear-task/relay.md").read_text()

    # stop kills a running step and halts the task; reset clears it.
    brief("slow-task")
    count = len(calls())
    run({**env, "STUB_SLEEP": "30"})
    end = time.time() + 10
    while len(calls()) == count:
        assert time.time() < end, "slow step never started"
        time.sleep(0.1)
    assert "slow-task" in run(env, "status").stdout
    assert run(env, "stop").returncode == 0 and not (evidence / "lock").exists()
    assert "stopped by hand" in state("slow-task")["halted"]
    run(env)
    assert "needs T'Jean" in (root / "vault/Tasks/slow-task/relay.md").read_text() and len(calls()) == count + 1
    run(env, "reset", "slow-task")
    assert not (evidence / "state" / "slow-task.json").exists()

    # Kill switch: without the switch file, nothing new starts.
    (root / "vault" / "Tasks" / ".relay-on").unlink()
    (evidence / "runs.json").write_text("{}")
    run(env)
    assert not (evidence / "lock").exists() and len(calls()) == count + 1

print("handoff relay: all checks passed")
