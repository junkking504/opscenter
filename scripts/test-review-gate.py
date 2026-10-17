"""Exercise deploy/macmini/check-review-gate.py against a throwaway repository."""
import pathlib
import subprocess
import sys
import tempfile

GATE = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "macmini" / "check-review-gate.py"


def run(*args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def commit(repo, name):
    (repo / name).write_text(name)
    run("git", "add", name, cwd=repo)
    run("git", "commit", "-qm", name, cwd=repo)
    return run("git", "rev-parse", "HEAD", cwd=repo)


def receipt(receipts, task, reviewer, builder, shas, state="approve", findings=""):
    folder = receipts / task
    folder.mkdir(parents=True, exist_ok=True)
    reviewed = "\n".join(f"Reviewer: {reviewer}  ·  Builder: {builder}  ·  Reviewed: task @ {sha}" for sha in shas)
    (folder / "review.md").write_text(f"# Review: {task}\n\n{reviewed}\n\n## Verdict\n{state}\n\n## Findings\n{findings}\n")


def gate(repo, active, target, receipts):
    result = subprocess.run([sys.executable, str(GATE), str(repo), active, target, str(receipts)], capture_output=True, text=True)
    return result.returncode, result.stdout + result.stderr


with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    repo, receipts = root / "repo", root / "receipts"
    repo.mkdir(); receipts.mkdir()
    run("git", "init", "-q", "-b", "production", cwd=repo)
    run("git", "config", "user.email", "test@example.invalid", cwd=repo)
    run("git", "config", "user.name", "Test", cwd=repo)
    active = commit(repo, "base")
    run("git", "checkout", "-qb", "task", cwd=repo)
    first = commit(repo, "one")
    second = commit(repo, "two")
    run("git", "checkout", "-q", "production", cwd=repo)
    commit(repo, "hotfix-on-production")
    run("git", "merge", "-q", "--no-ff", "-m", "integrate task", "task", cwd=repo)
    target = run("git", "rev-parse", "HEAD", cwd=repo)
    hotfix = run("git", "rev-parse", "HEAD^1", cwd=repo)

    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "3 commit(s)" in out, out

    receipt(receipts, "task", "Codex", "Claude", [second[:12]])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "1 commit(s)" in out and "hotfix-on-production" in out, "the task review covers both task commits, not the hotfix\n" + out

    receipt(receipts, "hotfix", "Claude", "Claude", [hotfix])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "same model" in out, "self-review never counts\n" + out

    receipt(receipts, "hotfix", "Claude", "Codex", [hotfix], findings="- [blocking] a.ts:1 broken")
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "open blocking finding" in out, out

    receipt(receipts, "hotfix", "Claude", "Codex", [hotfix], state="changes requested")
    assert gate(repo, active, target, receipts)[0] == 1

    receipt(receipts, "hotfix", "Claude", "Codex", [hotfix], state="waived by T'Jean, 2026-10-17, urgent fix")
    code, out = gate(repo, active, target, receipts)
    assert code == 0, out

    receipt(receipts, "task", "Codex", "Claude", [first])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "two" in out, "a review of an earlier commit does not cover later pushes\n" + out

    receipt(receipts, "task", "Codex", "Claude", [first, second])
    assert gate(repo, active, target, receipts)[0] == 0, "an addendum line covers the later push"

    receipt(receipts, "task", "Codex", "Claude", ["deadbeefdeadbeef"])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "not in this checkout" in out, out

    assert gate(repo, target, target, receipts)[0] == 0, "redeploying the active commit needs nothing new"

print("Review gate passed: missing receipts, self-review, blocking findings, verdicts, waivers, later pushes, addenda, unknown commits and integration merges.")
