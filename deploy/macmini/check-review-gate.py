#!/usr/bin/env python3
"""Refuse a production deployment whose new commits lack a cross-model review.

Usage: check-review-gate.py REPOSITORY ACTIVE_SHA TARGET_SHA RECEIPTS_DIR

Every non-merge commit in ACTIVE_SHA..TARGET_SHA must be reachable from a
commit named on a `Reviewed:` line of an approved or waived review receipt
(`*/review.md` under RECEIPTS_DIR). Merge commits made while integrating into
production are not reviewed separately. See docs/agent-handoffs.md.
"""
import pathlib
import re
import subprocess
import sys

HEADER = re.compile(r"Reviewer:\s*(?P<reviewer>[^·\n]+?)\s*·\s*Builder:\s*(?P<builder>[^·\n]+?)\s*·\s*Reviewed:", re.I)
REVIEWED = re.compile(r"Reviewed:\s*\S+\s*@\s*(?P<sha>[0-9a-f]{7,40})\b", re.I)
OPEN_BLOCKING = re.compile(r"^\s*-\s*\[blocking\]", re.I | re.M)


def git(repository, *args):
    return subprocess.run(["git", "-C", repository, *args], capture_output=True, text=True)


def verdict(text):
    section = re.search(r"^##\s*Verdict\s*$\n(?P<body>.*?)(?=^##\s|\Z)", text, re.M | re.S)
    lines = [line.strip().lower() for line in (section.group("body") if section else "").splitlines() if line.strip()]
    return lines[0] if lines else ""


def receipt_problem(text):
    header = HEADER.search(text)
    if not header:
        return "missing the Reviewer · Builder · Reviewed line"
    family = lambda name: name.strip().split()[0].lower()
    if family(header.group("reviewer")) == family(header.group("builder")):
        return "reviewer and builder are the same model"
    state = verdict(text)
    if state.startswith("waived by"):
        return None
    if state != "approve":
        return f"verdict is {state or 'missing'}"
    if OPEN_BLOCKING.search(text):
        return "approve with an open blocking finding"
    return None


def approved_commits(repository, receipts):
    covered, notes = [], []
    for path in sorted(pathlib.Path(receipts).glob("*/review.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        problem = receipt_problem(text)
        if problem:
            notes.append(f"{path.parent.name}: {problem}")
            continue
        for match in REVIEWED.finditer(text):
            resolved = git(repository, "rev-parse", "--verify", "--quiet", f"{match.group('sha')}^{{commit}}")
            if resolved.returncode == 0:
                covered.append(resolved.stdout.strip())
            else:
                notes.append(f"{path.parent.name}: reviewed commit {match.group('sha')} is not in this checkout")
    return covered, notes


def unreviewed(repository, active, target, covered):
    listed = git(repository, "rev-list", "--no-merges", f"{active}..{target}")
    if listed.returncode != 0:
        raise SystemExit(f"Review gate stopped: cannot list commits {active}..{target}: {listed.stderr.strip()}")
    missing = []
    for commit in listed.stdout.split():
        if not any(git(repository, "merge-base", "--is-ancestor", commit, head).returncode == 0 for head in covered):
            missing.append(commit)
    return missing


def main(argv):
    if len(argv) != 5:
        print(__doc__.strip(), file=sys.stderr)
        return 64
    repository, active, target, receipts = argv[1:]
    covered, notes = approved_commits(repository, receipts)
    missing = unreviewed(repository, active, target, covered)
    if not missing:
        print(f"Review gate passed: every new commit since {active[:12]} has an approved cross-model review.")
        return 0
    print(f"Review gate stopped: {len(missing)} commit(s) since the active release have no approved cross-model review.", file=sys.stderr)
    for commit in missing:
        subject = git(repository, "log", "-1", "--format=%h %s", commit).stdout.strip()
        print(f"  {subject}", file=sys.stderr)
    for note in notes:
        print(f"  receipt skipped: {note}", file=sys.stderr)
    print("Add vault/Tasks/<task>/review.md per docs/agent-handoffs.md, or record the user's waiver there.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
