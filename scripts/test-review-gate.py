"""Exercise deploy/macmini/check-review-gate.py against a throwaway repository."""
import pathlib
import subprocess
import sys
import tempfile

GATE = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "macmini" / "check-review-gate.py"


def run(*args, cwd, check=True):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=check).stdout.strip()


def commit(repo, name, text=None):
    (repo / name).write_text(text or name)
    run("git", "add", name, cwd=repo)
    run("git", "commit", "-qm", name, cwd=repo)
    return run("git", "rev-parse", "HEAD", cwd=repo)


def receipt(receipts, task, lines, state="approve", findings=""):
    folder = receipts / task
    folder.mkdir(parents=True, exist_ok=True)
    opening = "\n".join(f"Reviewer: {reviewer}  ·  Builder: {builder}  ·  Reviewed: task @ {sha}" for reviewer, builder, sha in lines)
    (folder / "review.md").write_text(f"# Review: {task}\n\n{opening}\n\n## Verdict\n{state}\n\n## Findings\n{findings}\n")


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
    hotfix = commit(repo, "hotfix-on-production")
    run("git", "merge", "-q", "--no-ff", "-m", "integrate task", "task", cwd=repo)
    target = run("git", "rev-parse", "HEAD", cwd=repo)

    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "3 commit(s)" in out, "a clean merge is exempt; its three parents' commits are not\n" + out

    receipt(receipts, "merged-tip", [("Claude", "Codex", target)])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "3 commit(s)" in out, "reviewing a merge tip must not cover any of its unreviewed ancestors\n" + out
    (receipts / "merged-tip" / "review.md").unlink()

    receipt(receipts, "task", [("Codex", "Claude", second[:12])])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "2 commit(s)" in out and first[:7] in out and hotfix[:7] in out, "a reviewed tip does not cover its unreviewed ancestor or the hotfix\n" + out

    code, out = gate(repo, first, second, receipts)
    assert code == 0, "an approve receipt names the only new commit (abbreviated SHA resolves exactly)\n" + out

    receipt(receipts, "task", [("Codex", "Claude", second)], state="waived by T'Jean, 2026-10-23, test waiver")
    code, out = gate(repo, active, second, receipts)
    assert code == 1 and "1 commit(s)" in out and first[:7] in out, "a waived tip does not cover its unreviewed ancestor\n" + out
    assert gate(repo, first, second, receipts)[0] == 0, "a waiver covers its named commit"

    receipt(receipts, "task", [("Codex", "Claude", first), ("Codex", "Claude", second)])

    receipt(receipts, "hotfix", [("Claude", "Claude", hotfix)])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "same model family" in out, "self-review never counts\n" + out

    for reviewer, builder in (("GPT-6 Codex", "Codex"), ("Anthropic Claude", "Claude Code"), ("Claude Opus", "Sonnet"),
                              ("ChatGPT", "OpenAI Codex"), ("Gemini", "Google Bard"), ("Mystery Model", "Codex"), ("Claude and Codex", "Gemini")):
        receipt(receipts, "hotfix", [(reviewer, builder, hotfix)])
        code, out = gate(repo, active, target, receipts)
        assert code == 1 and ("same model family" in out or "known families" in out), f"{reviewer} reviewing {builder} must not pass\n{out}"
    receipt(receipts, "hotfix", [("GPT-6 Codex", "Claude Code", hotfix)])
    receipt(receipts, "task", [("Codex", "Claude", first), ("Codex", "Claude", second)])
    assert gate(repo, active, target, receipts)[0] == 0, "each non-merge commit is named; the clean merge remains exempt; different-family aliases pass"

    receipt(receipts, "hotfix", [("Claude", "Codex", hotfix)], findings="- [blocking] a.ts:1 broken")
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "open blocking finding" in out, out

    receipt(receipts, "hotfix", [("Claude", "Codex", hotfix)], state="changes requested")
    assert gate(repo, active, target, receipts)[0] == 1

    for incomplete in ("waived", "waived by T'Jean", "waived by T'Jean, 2026-10-17", "waived by , 2026-10-17, urgent", "waived by T'Jean, 2026-13-45, urgent"):
        receipt(receipts, "hotfix", [("Claude", "Codex", hotfix)], state=incomplete)
        code, out = gate(repo, active, target, receipts)
        assert code == 1 and "waiver" in out, f"incomplete waiver {incomplete!r} must not pass\n{out}"

    receipt(receipts, "hotfix", [("Claude", "Codex", hotfix)], state="waived by T'Jean, 2026-10-17, urgent fix")
    code, out = gate(repo, active, target, receipts)
    assert code == 0, out

    receipt(receipts, "task", [("Codex", "Claude", first)])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "two" in out, "a review of an earlier commit does not cover later pushes\n" + out

    receipt(receipts, "task", [("Codex", "Claude", first), ("Claude", "Claude", second)])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "same model family" in out, "a self-reviewed addendum invalidates the receipt\n" + out

    receipt(receipts, "task", [("Codex", "Claude", first), ("Gemini", "Claude", second)])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "disagree" in out, "an addendum cannot switch reviewer\n" + out

    stray = f"- [non-blocking] note.\nReviewer: Codex  ·  Builder: Claude  ·  Reviewed: task @ {second}\nReviewed: task @ {second}"
    receipt(receipts, "task", [("Codex", "Claude", first)], findings=stray)
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "two" in out, "review lines outside the opening block are ignored\n" + out

    receipt(receipts, "task", [("Codex", "Claude", first), ("Codex", "Claude", second)])
    assert gate(repo, active, target, receipts)[0] == 0, "an addendum by the same reviewer covers the later push"

    receipt(receipts, "task", [("Codex", "Claude", "deadbeefdeadbeef")])
    code, out = gate(repo, active, target, receipts)
    assert code == 1 and "not in this checkout" in out, out
    receipt(receipts, "task", [("Codex", "Claude", first), ("Codex", "Claude", second)])

    # A merge that resolves a conflict, or slips in an extra change, needs its own review.
    run("git", "checkout", "-qb", "task-two", active, cwd=repo)
    branch_change = commit(repo, "shared.txt", "branch version")
    run("git", "checkout", "-q", "production", cwd=repo)
    production_change = commit(repo, "shared.txt", "production version")
    run("git", "merge", "-q", "task-two", cwd=repo, check=False)
    (repo / "shared.txt").write_text("hand resolved")
    run("git", "add", "shared.txt", cwd=repo)
    run("git", "commit", "-qm", "integrate task-two", cwd=repo)
    conflicted = run("git", "rev-parse", "HEAD", cwd=repo)
    receipt(receipts, "task-two", [("Codex", "Claude", branch_change)])
    receipt(receipts, "production-change", [("Claude", "Codex", production_change)])
    code, out = gate(repo, active, conflicted, receipts)
    assert code == 1 and "1 commit(s)" in out and "integrate task-two" in out, "a conflict resolution needs review\n" + out
    receipt(receipts, "integration", [("Codex", "Claude", conflicted)])
    assert gate(repo, active, conflicted, receipts)[0] == 0, "a reviewed integration merge passes"

    run("git", "checkout", "-qb", "task-three", conflicted, cwd=repo)
    three = commit(repo, "three")
    run("git", "checkout", "-q", "production", cwd=repo)
    run("git", "merge", "-q", "--no-ff", "--no-commit", "task-three", cwd=repo)
    (repo / "sneaky.txt").write_text("unreviewed")
    run("git", "add", "sneaky.txt", cwd=repo)
    run("git", "commit", "-qm", "integrate task-three", cwd=repo)
    evil = run("git", "rev-parse", "HEAD", cwd=repo)
    receipt(receipts, "task-three", [("Codex", "Claude", three)])
    code, out = gate(repo, conflicted, evil, receipts)
    assert code == 1 and "integrate task-three" in out, "an extra change inside a merge needs review\n" + out

    assert gate(repo, target, target, receipts)[0] == 0, "redeploying the active commit needs nothing new"

print("Review gate passed: per-commit approvals and waivers, unreviewed ancestors, missing receipts, self-review, model aliases and unknown names, addenda, stray review lines, blocking findings, verdicts, complete waivers, later pushes, unknown commits, clean merges, conflict resolutions and changed merges.")
