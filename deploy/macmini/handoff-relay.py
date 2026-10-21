#!/usr/bin/env python3
"""Start the next Claude/Codex step for opted-in vault tasks, one at a time.

launchd runs this every two minutes on Mission Control. Each run reads
vault/Tasks/<task>/{brief,handoff,review}.md (docs/agent-handoffs.md), picks at
most one next step for one task, starts it detached, and exits. It never
merges, deploys or sends anything; an approved task waits for the user.

  handoff-relay.py              live tick (does nothing unless vault/Tasks/.relay-on exists)
  handoff-relay.py --dry-run    print what a tick would start; writes and launches nothing
  handoff-relay.py status       print each opted-in task's state
  handoff-relay.py stop         kill the running step and leave the task halted
  handoff-relay.py reset <task> clear a task's relay state after the user has looked at it
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

MAX_REVIEWS = 3          # build + up to two fix rounds, then the user decides
MAX_RUNS_PER_DAY = 6     # agent runs across all tasks, to stay inside the included allowance
STEP_TIMEOUT = int(os.environ.get("RELAY_STEP_TIMEOUT", 60 * 60))  # seconds per step
TERM_GRACE = int(os.environ.get("RELAY_TERM_GRACE", 15))           # seconds between SIGTERM and SIGKILL
START_GRACE = 120        # seconds a freshly started runner may take to publish itself
GATE_HINTS: list[Path] = []  # extra places to look for check-review-gate.py, set in main()
CODEX_DEFAULT = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
# A diff touching any of these gets the Opus reviewer instead of Sonnet.
SENSITIVE = re.compile(
    r"send|sms|whatsapp|imessage|message|email|notif|push|payroll|pay|billing|invoice|money|"
    r"spend|stripe|qbo|quickbooks|secret|token|credential|auth|login|session|deploy|release|launchd|migration",
    re.I,
)
# Credentials a launched Claude must not see, so it stays on the subscription login.
SCRUB_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
             "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "OPENAI_API_KEY")
FAMILIES = {"anthropic": ("claude", "opus", "sonnet", "haiku", "fable"),
            "openai": ("codex", "gpt", "chatgpt")}


class Paths:
    def __init__(self, root: Path):
        self.root = root
        self.tasks = root / "vault" / "Tasks"
        self.switch = self.tasks / ".relay-on"
        self.repo = root / "repository"
        self.worktrees = root / "worktrees"
        self.evidence = root / "task-evidence" / "handoff-relay"
        self.log = self.evidence / "relay.log"
        self.lock = self.evidence / "lock"
        self.state = self.evidence / "state"
        self.runs = self.evidence / "runs.json"


def now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(p: Paths, line: str, dry: bool) -> None:
    text = f"{now()} {'[dry-run] ' if dry else ''}{line}"
    print(text)
    if not dry:
        p.evidence.mkdir(parents=True, exist_ok=True)
        with p.log.open("a") as fh:
            fh.write(text + "\n")


def read(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def section(text: str, heading: str) -> str:
    """Body of the last `## <heading>` section."""
    parts = re.split(r"(?m)^##\s+", text)
    body = ""
    for part in parts[1:]:
        title, _, rest = part.partition("\n")
        if title.strip().lower() == heading.lower():
            body = rest
    return body


def family(name: str) -> str | None:
    hits = {fam for fam, words in FAMILIES.items() if any(w in name.lower() for w in words)}
    return hits.pop() if len(hits) == 1 else None


def open_questions(brief: str) -> bool:
    for line in section(brief, "Open questions").splitlines():
        line = line.strip().lstrip("-*").strip().rstrip(".").lower()
        if line and line not in ("none", "empty if none", "n/a", "no open questions"):
            return True
    return False


def review_gate():
    """The production review-gate module, so the relay reads receipts exactly as the gate does."""
    for folder in (Path(__file__).resolve().parent, *GATE_HINTS):
        path = folder / "check-review-gate.py"
        if path.is_file():
            spec = importlib.util.spec_from_file_location("check_review_gate", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    return None


def parse_receipt(text: str) -> dict | None:
    if not text.strip():
        return None
    gate = review_gate()
    if gate is None:
        return {"error": "check-review-gate.py not found next to the relay"}
    shas, problem = gate.review_lines(text)
    if problem:
        return {"error": problem}
    state = gate.verdict(text).strip().lower()
    return {"shas": shas, "verdict": state,
            "approve_problem": gate.receipt_problem(text) if state == "approve" else None}


def parse_task(folder: Path) -> dict:
    brief, handoff, review = (read(folder / n) for n in ("brief.md", "handoff.md", "review.md"))
    mode = re.search(r"(?mi)^Auto:\s*(codex-build|review)\s*$", brief)
    info = {"auto": mode.group(1).lower() if mode else "",
            "questions": open_questions(brief), "has_handoff": bool(handoff.strip())}
    builder = re.search(r"(?m)^Builder:\s*([^·\n]+)", handoff)
    info["builder"] = builder.group(1).strip() if builder else ""
    heads = re.findall(r"Branch:\s*(\S+)\s*@\s*([0-9a-f]{7,40})", handoff)
    info["branch"], info["head"] = heads[-1] if heads else ("", "")
    info["receipt"] = parse_receipt(review)
    try:
        info["review_newer"] = (folder / "review.md").stat().st_mtime >= (folder / "handoff.md").stat().st_mtime
    except OSError:
        info["review_newer"] = False
    return info


def same_sha(a: str, b: str) -> bool:
    return bool(a and b) and (a.startswith(b) or b.startswith(a))


def load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def git(p: Paths, cwd: Path, *args: str) -> str:
    try:
        out = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def decide(p: Paths, task: str, info: dict, state: dict) -> tuple[str, str]:
    """Return (action, detail). Actions: build, review-claude, review-codex, fix, or a resting state."""
    if state.get("halted"):
        return "needs-user", state["halted"]
    if info["questions"]:
        return "needs-user", "the brief has open questions"
    done = state.get("done", [])
    if not info["has_handoff"]:
        if info["auto"] == "review":
            return "wait", "review-only task; waiting for the builder's handoff.md"
        if "build" in done:
            return "needs-user", "Codex finished the build step without writing handoff.md"
        return "build", "no handoff yet"
    fam, head = family(info["builder"]), info["head"]
    if not fam or not head:
        return "needs-user", "handoff.md has no recognisable Builder line or Branch @ sha"
    worktree = p.worktrees / task
    actual = git(p, worktree, "rev-parse", "HEAD") if worktree.exists() else ""
    if actual and not same_sha(actual, head):
        return "wait", f"worktree HEAD {actual[:12]} is not the handoff head {head[:12]}"
    reviews = sum(1 for d in done if d.startswith("review@"))
    receipt = info["receipt"]
    if receipt and receipt.get("error"):
        return "needs-user", f"review.md is not a valid receipt: {receipt['error']}"
    if not receipt or not same_sha(receipt["shas"][-1], head):
        if f"review@{head}" in done:
            return "needs-user", f"the reviewer ran for {head[:12]} but review.md does not name it"
        if reviews >= MAX_REVIEWS:
            return "needs-user", f"loop limit: {reviews} reviews already"
        return ("review-claude" if fam == "openai" else "review-codex"), f"head {head[:12]} unreviewed"
    if len({s[:7] for s in receipt["shas"]}) > 1 and not info["review_newer"]:
        return "needs-user", "review.md names several heads and is older than handoff.md; a person checks which one it covers"
    verdict = receipt["verdict"]
    if verdict.startswith("waived"):
        return "ready", f"waived at {head[:12]}; merge and deploy are T'Jean's call"
    if verdict == "approve":
        if receipt["approve_problem"]:
            return "needs-user", f"approval does not hold: {receipt['approve_problem']}"
        return "ready", f"approved at {head[:12]}; merge and deploy are T'Jean's call"
    if verdict == "changes requested":
        if fam != "openai":
            return "waiting-claude", "changes requested on a Claude-built branch"
        if info["auto"] != "codex-build":
            return "wait", "changes requested, but this task is review-only; the builder fixes it"
        if reviews >= MAX_REVIEWS:
            return "needs-user", f"loop limit: {reviews} reviews, still changes requested"
        if f"fix@{head}" in done:
            return "needs-user", "Codex ran the fix but handoff.md still names the reviewed head"
        return "fix", f"changes requested at {head[:12]}"
    return "needs-user", f"review verdict is '{verdict or 'missing'}'"


def reviewer_model(p: Paths, task: str) -> str:
    names = git(p, p.worktrees / task, "diff", "--name-only", "origin/production...HEAD")
    if not names:
        return "opus"  # could not read the diff, so take the careful reviewer
    return "opus" if SENSITIVE.search(names) else "sonnet"


def find_claude() -> str:
    extra = [os.path.expanduser(d) for d in ("~/.local/bin", "~/.claude/local", "/opt/homebrew/bin", "/usr/local/bin")]
    return os.environ.get("RELAY_CLAUDE_BIN") or shutil.which("claude", path=os.pathsep.join([os.environ.get("PATH", ""), *extra])) or ""


def command(p: Paths, task: str, action: str) -> tuple[list[str], Path, dict]:
    vault, worktree = p.tasks / task, p.worktrees / task
    codex = os.environ.get("RELAY_CODEX_BIN", CODEX_DEFAULT)
    files = f"Read {vault}/brief.md and handoff.md and follow docs/agent-handoffs.md and AGENTS.md."
    env = {k: v for k, v in os.environ.items() if k not in SCRUB_ENV}
    out = p.evidence / f"{task}-last-message.md"
    if action in ("build", "fix"):
        what = ("Build vault task {t}. Read {v}/brief.md first; it is the spec." if action == "build" else
                "Fix the [blocking] findings in {v}/review.md for vault task {t}, then add an update section to handoff.md naming the new head.")
        prompt = (what.format(t=task, v=vault) + f" Work only in this worktree on branch codex/{task}. Commit and push only that branch. "
                  f"Write {vault}/handoff.md when ready. Do not merge, deploy, edit review.md, or send any message.")
        cmd = [codex, "exec", "-C", str(worktree), "--approve-for-me",
               "-c", "sandbox_workspace_write.network_access=true",
               "--add-dir", str(p.repo / ".git"), "--add-dir", str(vault), "-o", str(out), prompt]
        return cmd, worktree, env
    review = (f"Review branch at {worktree} against origin/production. {files} Write the review receipt to {vault}/review.md "
              "using the exact opening line format from docs/agent-handoffs.md. Do not edit any other file, push, merge, deploy, or send anything.")
    if action == "review-codex":
        # Writable root is the vault task folder only, so source files cannot change.
        # The vault is not a Git repo, so codex needs --skip-git-repo-check there.
        return [codex, "exec", "-C", str(vault), "--approve-for-me", "--skip-git-repo-check", "-o", str(out), review], vault, env
    target = f"//{str(vault / 'review.md').lstrip('/')}"
    cmd = [find_claude() or "claude", "-p", review, "--model", reviewer_model(p, task), "--add-dir", str(vault),
           "--allowedTools", f"Read,Grep,Glob,Write({target}),Edit({target}),Bash(git diff:*),Bash(git log:*),Bash(git show:*)",
           "--disallowedTools", "Bash(git push:*),WebFetch,WebSearch"]
    return cmd, worktree, env


def group_alive(pgid) -> bool:
    """True while any live process is in the process group. Zombies do not count."""
    if not pgid:
        return False
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    if Path("/proc/self/stat").exists():  # Linux: a group of only zombies is finished
        for stat in Path("/proc").glob("[0-9]*/stat"):
            try:
                fields = stat.read_text().rsplit(")", 1)[1].split()
            except (OSError, IndexError):
                continue
            if fields[0] != "Z" and int(fields[2]) == pgid:
                return True
        return False
    return True


def end_group(pgid: int) -> bool:
    """SIGTERM, then SIGKILL, the whole group. True only once it is confirmed gone."""
    for sig, wait in ((signal.SIGTERM, TERM_GRACE), (signal.SIGKILL, 10)):
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            return True
        except OSError:
            pass
        end = time.time() + wait
        while time.time() < end:
            if not group_alive(pgid):
                return True
            time.sleep(0.2)
    return not group_alive(pgid)


def write_status(p: Paths, task: str, action: str, detail: str, state: dict) -> None:
    reviews = sum(1 for d in state.get("done", []) if d.startswith("review@"))
    label = {"build": "Codex building", "fix": "Codex fixing", "review-claude": "Claude reviewing",
             "review-codex": "Codex reviewing", "ready": "ready for T'Jean", "needs-user": "needs T'Jean",
             "waiting-claude": "waiting for Claude thread", "wait": "waiting", "running": "step running"}[action]
    text = (f"# Relay: {task}\n\nState: {label}  ·  Reviews: {reviews} of {MAX_REVIEWS}  ·  Updated: {now()}\n\n"
            f"{detail}\n\nLog: `task-evidence/handoff-relay/relay.log`. Kill switch: delete `vault/Tasks/.relay-on`.\n")
    path = p.tasks / task / "relay.md"
    if re.sub(r"Updated: [^\n]*", "", read(path)) != re.sub(r"Updated: [^\n]*", "", text):
        path.write_text(text)


def runs_today(p: Paths) -> int:
    return load(p.runs, {}).get(datetime.date.today().isoformat(), 0)


def tick(p: Paths, dry: bool) -> int:
    if not dry and not p.switch.exists():
        return 0
    held = load(p.lock / "step.json", None) if p.lock.exists() else None
    if p.lock.exists() and not held:
        log(p, "lock exists without a step record; leaving it for a person to check", dry)
        return 0
    if held:
        runner = load(p.lock / "runner.json", {}).get("pid")
        if not runner and time.time() - held.get("started", 0) < START_GRACE:
            return 0  # the runner is still starting
        if group_alive(runner):
            if time.time() - held.get("started", 0) > STEP_TIMEOUT + 2 * TERM_GRACE + 60:
                log(p, f"{held['task']}: step {held['action']} overran; stopping it", dry)
                if not dry:
                    stop(p, f"step {held['action']} overran the time limit")
            return 0
        log(p, f"{held.get('task')}: step {held.get('action')} ended without releasing the lock", dry)
        if not dry:
            halt(p, held.get("task", ""), "the last step ended unexpectedly; check the log")
            shutil.rmtree(p.lock, ignore_errors=True)
        return 0
    if not p.tasks.is_dir():
        return 0
    folders = sorted((f for f in p.tasks.iterdir() if f.is_dir() and (f / "brief.md").exists()),
                     key=lambda f: (f / "brief.md").stat().st_mtime)
    for folder in folders:
        info = parse_task(folder)
        if not info["auto"]:
            continue
        task = folder.name
        state = load(p.state / f"{task}.json", {})
        action, detail = decide(p, task, info, state)
        if not dry:
            write_status(p, task, action, detail, state)
        if action not in ("build", "fix", "review-claude", "review-codex"):
            if dry or state.get("last_logged") != f"{action}:{detail}":
                log(p, f"{task}: {action} ({detail})", dry)
                if not dry:
                    state["last_logged"] = f"{action}:{detail}"
                    save(p.state / f"{task}.json", state)
            continue
        if runs_today(p) >= MAX_RUNS_PER_DAY:
            log(p, f"{task}: {action} held, daily cap of {MAX_RUNS_PER_DAY} runs reached", dry)
            return 0
        cmd, cwd, _ = command(p, task, action)
        log(p, f"{task}: start {action} ({detail}) -> {cmd[0]} {' '.join(cmd[1:3])} ... in {cwd}", dry)
        if dry:
            return 0
        try:
            p.lock.mkdir(parents=True)  # raises if another tick won the race
            save(p.lock / "step.json", {"task": task, "action": action, "started": time.time()})
            subprocess.Popen([sys.executable, os.path.abspath(__file__), "--root", str(p.root), "_step", task, action],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        except Exception as exc:  # nothing was started, so nothing is owned
            shutil.rmtree(p.lock, ignore_errors=True)
            log(p, f"{task}: could not start {action}: {exc}", False)
        return 0
    return 0


def step(p: Paths, task: str, action: str) -> int:
    """Runs detached as its own process group leader; the agent joins that group.

    The group id (this process's pid) is published in runner.json before any agent starts, so
    `stop` and the next tick always know what to wait for. The lock is released only on a clean
    finish; a kill takes the runner too, and the next tick clears the lock once the group is gone.
    """
    save(p.lock / "runner.json", {"pid": os.getpid()})
    state = load(p.state / f"{task}.json", {})
    head = parse_task(p.tasks / task)["head"]
    key = "build" if action == "build" else f"{'fix' if action == 'fix' else 'review'}@{head}"
    runs = load(p.runs, {})
    today = datetime.date.today().isoformat()
    save(p.runs, {today: runs.get(today, 0) + 1})
    agent_log = p.evidence / f"{task}-{action}.log"
    release = True
    try:
        if action == "build" and not (p.worktrees / task).exists():
            git(p, p.repo, "fetch", "origin", "production")
            made = subprocess.run(["git", "-C", str(p.repo), "worktree", "add", "-b", f"codex/{task}",
                                   str((p.worktrees / task).resolve()), "origin/production"], capture_output=True, text=True)
            if made.returncode != 0:
                raise RuntimeError(f"git worktree add failed: {made.stderr.strip()[:200]}")
        cmd, cwd, env = command(p, task, action)
        with agent_log.open("a") as out:
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=out)
            try:
                code = proc.wait(timeout=STEP_TIMEOUT)
            except subprocess.TimeoutExpired:
                # Record the outcome first: the final SIGKILL takes this runner down with the agent.
                state.setdefault("done", []).append(key)
                state["halted"] = f"{action} timed out after {STEP_TIMEOUT // 60} minutes and was killed"
                save(p.state / f"{task}.json", state)
                log(p, f"{task}: {action} timed out; ending its process group", False)
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                release = False
                if not end_group(os.getpid()):
                    log(p, f"{task}: {action} would not end; the lock stays until it does", False)
                return 1
        state.setdefault("done", []).append(key)
        if code != 0:
            state["halted"] = f"{action} exited with code {code}; see task-evidence/handoff-relay/{agent_log.name}"
        save(p.state / f"{task}.json", state)
        log(p, f"{task}: {action} finished, exit {code}", False)
    except Exception as exc:  # any failure halts the task for the user, never retries
        state.setdefault("done", []).append(key)
        state["halted"] = f"{action} failed: {exc}"
        save(p.state / f"{task}.json", state)
        log(p, f"{task}: {action} failed: {exc}", False)
    finally:
        if release:
            shutil.rmtree(p.lock, ignore_errors=True)
    return 0


def halt(p: Paths, task: str, reason: str) -> None:
    if task:
        state = load(p.state / f"{task}.json", {})
        state.setdefault("halted", reason)  # the first reason is the real one
        save(p.state / f"{task}.json", state)


def stop(p: Paths, reason: str = "stopped by hand") -> int:
    held = load(p.lock / "step.json", None)
    if not held:
        print("No step is running.")
        return 0
    runner = load(p.lock / "runner.json", {}).get("pid")
    if runner and not end_group(runner):
        log(p, f"{held.get('task')}: {held.get('action')} did not end after SIGKILL; the lock stays", False)
        return 1
    halt(p, held.get("task", ""), reason)
    shutil.rmtree(p.lock, ignore_errors=True)
    log(p, f"{held.get('task')}: {held.get('action')} stopped ({reason})", False)
    return 0


def status(p: Paths) -> int:
    print(f"Relay {'ON' if p.switch.exists() else 'OFF'}; runs today {runs_today(p)} of {MAX_RUNS_PER_DAY}")
    held = load(p.lock / "step.json", None)
    if held:
        print(f"Running: {held.get('task')} {held.get('action')} (group {load(p.lock / 'runner.json', {}).get('pid')})")
    if p.tasks.is_dir():
        for folder in sorted(p.tasks.iterdir()):
            if folder.is_dir() and parse_task(folder)["auto"]:
                state = load(p.state / f"{folder.name}.json", {})
                print(f"{folder.name}: {' / '.join(decide(p, folder.name, parse_task(folder), state))}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.environ.get("RELAY_ROOT", "/Users/missioncontrol/opscenter-v2"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("command", nargs="?", default="tick", choices=("tick", "status", "stop", "reset", "_step"))
    ap.add_argument("args", nargs="*")
    a = ap.parse_args()
    p = Paths(Path(a.root))
    GATE_HINTS.append(p.root / "opscenter" / "deploy" / "macmini")
    if a.command == "status":
        return status(p)
    if a.command == "stop":
        return stop(p)
    if a.command == "reset":
        if len(a.args) != 1:
            ap.error("reset needs a task name")
        (p.state / f"{a.args[0]}.json").unlink(missing_ok=True)
        log(p, f"{a.args[0]}: relay state reset by hand", False)
        return 0
    if a.command == "_step":
        return step(p, *a.args)
    return tick(p, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
