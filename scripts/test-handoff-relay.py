"""Exercise deploy/macmini/handoff-relay.py with stand-in codex and claude commands in a throwaway workspace."""
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

DEPLOY = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "macmini"
RELAY = DEPLOY / "handoff-relay.py"

# Stand-ins record their arguments, environment and process ids, then do what the real agent would to the task files.
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, re, signal, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["STUB_CALLS"], "a") as fh:
    fh.write(json.dumps({"tool": name, "args": args, "api_key": "ANTHROPIC_API_KEY" in os.environ, "cwd": os.getcwd(), "pid": os.getpid()}) + "\n")
if os.environ.get("STUB_IGNORE_TERM"):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
if os.environ.get("STUB_SPAWN_CHILD"):
    child = subprocess.Popen(["sleep", "60"])
    pathlib.Path(os.environ["STUB_SPAWN_CHILD"]).write_text(str(child.pid))
if os.environ.get("STUB_SLEEP"):
    time.sleep(int(os.environ["STUB_SLEEP"]))
prompt = args[-1] if name == "codex" else args[args.index("-p") + 1]
vault = pathlib.Path(re.search(r"(/\S+/vault/Tasks/[^/\s]+)", prompt).group(1))
task = vault.name
work = vault.parent.parent.parent / "worktrees" / task
def git(*a):
    return subprocess.run(["git", "-C", str(work), *a], capture_output=True, text=True, check=True).stdout.strip()
def commit(label):
    target = work / os.environ.get("STUB_FILE", "lib/feature.ts")
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "a") as fh:
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


def run(env, *args, root_path=None):
    return subprocess.run([sys.executable, str(RELAY), "--root", str(root_path or root), *args], capture_output=True, text=True, env=env)


def wait_until(check, what, timeout=20):
    end = time.time() + timeout
    while not check():
        assert time.time() < end, what
        time.sleep(0.1)


def wait_idle(timeout=30):
    wait_until(lambda: not (root / "task-evidence" / "handoff-relay" / "lock").exists(), "step did not finish", timeout)


def calls():
    path = root / "stub-calls"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def state(task):
    return json.loads((root / "task-evidence" / "handoff-relay" / "state" / f"{task}.json").read_text())


def relay_md(task):
    return (root / "vault" / "Tasks" / task / "relay.md").read_text()


def brief(task, auto="Auto: codex-build", questions="None"):
    folder = root / "vault" / "Tasks" / task
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "brief.md").write_text(f"# Brief: {task}\n\nPlanner: Claude\n{auto}\n\n## Goal\nx\n\n## Open questions\n- {questions}\n")
    time.sleep(0.02)  # tasks are taken oldest brief first


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    stat = pathlib.Path(f"/proc/{pid}/stat")
    return not (stat.exists() and stat.read_text().rsplit(")", 1)[1].split()[0] == "Z")


def sh(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


def load_relay_module():
    spec = importlib.util.spec_from_file_location("handoff_relay_under_test", RELAY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with tempfile.TemporaryDirectory() as tmp:
    temp = os.path.realpath(tmp)  # macOS reports /private/var for /var
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
           "STUB_VERDICT": "changes requested", "RELAY_TERM_GRACE": "1"}
    evidence = root / "task-evidence" / "handoff-relay"
    lock = evidence / "lock"

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
    assert "loop limit" in relay_md("loop-task") and "needs T'Jean" in relay_md("loop-task")
    assert subprocess.run(["git", "-C", str(root / "worktrees/loop-task"), "branch", "--show-current"],
                          capture_output=True, text=True).stdout.strip() == "codex/loop-task"
    claude_calls = [c for c in calls() if c["tool"] == "claude"]
    assert not any(c["api_key"] for c in claude_calls), "API key is scrubbed before Claude runs"
    assert all(c["args"][c["args"].index("--model") + 1] == "sonnet" for c in claude_calls)
    allowed = claude_calls[0]["args"][claude_calls[0]["args"].index("--allowedTools") + 1]
    assert "Write(//" in allowed and allowed.count("review.md") == 2 and "Bash(git push" not in allowed
    assert "Bash(git push:*)" in claude_calls[0]["args"][claude_calls[0]["args"].index("--disallowedTools") + 1]
    codex_build = calls()[0]["args"]
    assert codex_build[:4] == ["exec", "-C", str(root / "worktrees/loop-task"), "--approve-for-me"]
    assert all("-s" not in c["args"] for c in calls() if c["tool"] == "codex"), "--approve-for-me already implies the sandbox"
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
    assert "ready for T'Jean" in relay_md("approve-task")
    review = [c for c in calls() if c["tool"] == "claude"][-1]
    assert review["args"][review["args"].index("--model") + 1] == "opus"
    assert len(calls()) == 8

    # A Claude-built branch is reviewed by Codex, inside the vault folder; changes go back to the Claude thread.
    brief("claude-built", auto="Auto: review")
    run(env)
    assert "waiting" in relay_md("claude-built") and len(calls()) == 8
    sh("git", "-C", str(root / "repository"), "worktree", "add", "-q", "-b", "claude/x", str(root / "worktrees/claude-built"), "origin/production")
    head = subprocess.run(["git", "-C", str(root / "worktrees/claude-built"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    (root / "vault/Tasks/claude-built/handoff.md").write_text(f"# Handoff\n\nBuilder: Claude  ·  Branch: claude/x @ {head}  ·  Base: x\n")
    for _ in range(2):
        run(env)
        wait_idle()
    assert calls()[-1]["tool"] == "codex" and calls()[-1]["cwd"] == str(root / "vault/Tasks/claude-built")
    assert "--skip-git-repo-check" in calls()[-1]["args"], "the vault is not a Git repo"
    assert "waiting for Claude thread" in relay_md("claude-built")

    # Open questions in the brief stop the relay before anything runs.
    brief("unclear-task", questions="Which crews are in scope?")
    run(env)
    assert "open questions" in relay_md("unclear-task")

    # Review-only tasks never fix: a Codex-built branch with changes requested waits for its builder.
    fake = "a" * 40
    count = len(calls())

    def receipt(task, builder_line, review_text, auto="Auto: review"):
        brief(task, auto=auto)
        folder = root / "vault/Tasks" / task
        (folder / "handoff.md").write_text(f"# Handoff\n\n{builder_line}  ·  Branch: codex/x @ {fake}  ·  Base: x\n")
        time.sleep(0.02)
        (folder / "review.md").write_text(review_text)
        run(env)
        return relay_md(task)

    verdict_changes = f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\nchanges requested\n"
    note = receipt("review-only", "Builder: Codex", verdict_changes)
    assert "State: waiting " in note and len(calls()) == count, note

    # The relay reads receipts the way the deployment gate does: bad ones need a person, never "ready".
    blocking = f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\napprove\n\n## Findings\n- [blocking] x.py:1 broken\n"
    same_family = f"Reviewer: Codex  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\napprove\n"
    addendum_only = f"# Review\n\n## Verdict\napprove\n\n## Addendum\nReviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n"
    bad_waiver = f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\nwaived\n"
    bad_date = f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\nwaived by T'Jean, 2026-02-31, tested\n"
    for task, text in (("open-blocker", blocking), ("same-family", same_family), ("addendum-only", addendum_only),
                       ("bare-waiver", bad_waiver), ("bad-waiver-date", bad_date)):
        note = receipt(task, "Builder: Codex", text)
        assert "needs T'Jean" in note and "ready" not in note, (task, note)
    note = receipt("good-receipt", "Builder: Codex", f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\napprove\n")
    assert "ready for T'Jean" in note and len(calls()) == count, note
    note = receipt("good-waiver", "Builder: Codex", f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\nwaived by T'Jean, 2026-10-21, tested on the Mac\n")
    assert "ready for T'Jean" in note, note
    two_heads = f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {'c' * 40}\nReviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\napprove\n"
    folder = root / "vault/Tasks/two-heads"
    brief("two-heads", auto="Auto: review")
    (folder / "review.md").write_text(two_heads)
    time.sleep(0.02)
    (folder / "handoff.md").write_text(f"# Handoff\n\nBuilder: Codex  ·  Branch: codex/x @ {fake}  ·  Base: x\n")
    run(env)
    assert "needs T'Jean" in relay_md("two-heads"), "an older receipt that lists several heads is not trusted"
    for task in ("open-blocker", "same-family", "addendum-only", "bare-waiver", "bad-waiver-date", "good-receipt",
                 "good-waiver", "two-heads", "review-only"):
        brief(task, auto="")  # keep the rest of the run to the tasks under test

    # The lock: a second contender never touches the first one's lock.
    relay = load_relay_module()
    paths = relay.Paths(root)
    assert relay.acquire(paths, "winner", "build") is True
    before = (lock / "step.json").read_text()
    assert relay.acquire(paths, "loser", "build") is False
    assert (lock / "step.json").read_text() == before and lock.exists(), "a losing contender leaves the winner's lock alone"
    shutil.rmtree(lock)

    # Stop during startup: no runner or agent yet, so stop records a cancel and leaves the lock in place.
    brief("starting-task")
    (lock).mkdir(parents=True)
    (lock / "step.json").write_text(json.dumps({"task": "starting-task", "action": "build", "started": time.time()}))
    stopped = run(env, "stop")
    assert stopped.returncode == 1 and (lock / "cancel").exists() and lock.exists(), stopped.stdout
    # The runner that then starts honours the cancel: no agent runs, the task halts, and the lock is released.
    before_calls = len(calls())
    run_step = subprocess.run([sys.executable, str(RELAY), "--root", str(root), "_step", "starting-task", "build"],
                              capture_output=True, text=True, env=env)
    assert run_step.returncode == 0 and len(calls()) == before_calls, run_step.stderr
    assert not lock.exists() and "before the step started" in state("starting-task")["halted"]

    # A step that ignores SIGTERM is killed; the lock is released only once its group is gone.
    fast = {**env, "RELAY_STEP_TIMEOUT": "1", "STUB_SLEEP": "60", "STUB_IGNORE_TERM": "1"}
    brief("stuck-task")
    count = len(calls())
    run(fast)
    wait_until(lambda: len(calls()) > count, "the stuck step never started")
    pid = calls()[-1]["pid"]
    wait_idle()
    assert not alive(pid), "the SIGTERM-resistant agent was killed before its lock was released"
    assert "timed out" in state("stuck-task")["halted"], state("stuck-task")
    assert len(calls()) == count + 1

    # A step whose agent leaves a child behind: the child is ended before the lock is released.
    child_file = pathlib.Path(temp) / "child.pid"
    brief("spawn-task")
    run({**env, "STUB_SPAWN_CHILD": str(child_file)})
    wait_idle()
    child = int(child_file.read_text())
    assert not alive(child), "a child left by the agent is ended before the lock is released"
    assert state("spawn-task")["done"] == ["build"] and "halted" not in state("spawn-task")
    brief("spawn-task", auto="")  # its review would otherwise take the lock from the stop test below

    # Manual stop of a running step ends the agent group, then the runner, then releases the lock.
    brief("stop-task")
    count = len(calls())
    run({**env, "RELAY_STEP_TIMEOUT": "600", "STUB_SLEEP": "60", "STUB_IGNORE_TERM": "1"})
    wait_until(lambda: len(calls()) > count, "the stop step never started")
    wait_until(lambda: (lock / "runner.json").exists() and json.loads((lock / "runner.json").read_text()).get("agent"),
               "the runner never recorded its agent")
    pid = calls()[-1]["pid"]
    assert lock.exists() and alive(pid)
    assert run({**env, "RELAY_STEP_TIMEOUT": "600"}, "stop").returncode == 0
    assert not alive(pid) and not lock.exists()
    assert "stopped by hand" in state("stop-task")["halted"]
    for task in ("stuck-task", "stop-task", "starting-task"):
        brief(task, auto="")

    # Kill switch: without the switch file, nothing new starts.
    (root / "vault" / "Tasks" / ".relay-on").unlink()
    (evidence / "runs.json").write_text("{}")
    count = len(calls())
    run(env)
    assert not lock.exists() and len(calls()) == count

    # A dry run against a cold cache leaves no bytecode next to the relay or its gate checker.
    bundle = pathlib.Path(temp) / "bundle"
    bundle.mkdir()
    shutil.copy(RELAY, bundle / "handoff-relay.py")
    shutil.copy(DEPLOY / "check-review-gate.py", bundle / "check-review-gate.py")
    dry_root = pathlib.Path(temp) / "dry"
    (dry_root / "vault" / "Tasks" / "receipt-task").mkdir(parents=True)
    (dry_root / "vault" / "Tasks" / "receipt-task" / "brief.md").write_text("Planner: Claude\nAuto: review\n## Open questions\n- None\n")
    (dry_root / "vault" / "Tasks" / "receipt-task" / "handoff.md").write_text(f"Builder: Codex  ·  Branch: codex/x @ {fake}\n")
    (dry_root / "vault" / "Tasks" / "receipt-task" / "review.md").write_text(f"Reviewer: Claude  ·  Builder: Codex  ·  Reviewed: b @ {fake}\n\n## Verdict\napprove\n")
    (dry_root / "vault" / "Tasks" / ".relay-on").write_text("")
    dry_env = {k: v for k, v in env.items() if k != "PYTHONDONTWRITEBYTECODE"}
    dry_result = subprocess.run([sys.executable, str(bundle / "handoff-relay.py"), "--root", str(dry_root), "--dry-run"],
                                capture_output=True, text=True, env=dry_env)
    assert dry_result.returncode == 0 and "receipt-task: ready" in dry_result.stdout, dry_result.stdout + dry_result.stderr
    assert not list(bundle.rglob("__pycache__")), "a dry run writes no bytecode"

print("handoff relay: all checks passed")
