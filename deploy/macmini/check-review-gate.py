#!/usr/bin/env python3
"""Refuse a production deployment whose new commits lack a cross-model review.

Usage: check-review-gate.py REPOSITORY ACTIVE_SHA TARGET_SHA RECEIPTS_DIR

Every commit in ACTIVE_SHA..TARGET_SHA must itself be named on a review line
of an approved or waived receipt (`*/review.md` under
RECEIPTS_DIR). A two-parent merge is exempt only when its tree is exactly what
Git's automatic merge produces, so conflict resolutions and any other change
made in a merge still need a review. The installed deployment controller runs
this check. See docs/agent-handoffs.md.
"""
import datetime as dt
import pathlib
import re
import subprocess
import sys

# Review lines belong to the receipt's opening block, before the first section.
REVIEW_LINE = re.compile(
    r"^Reviewer:\s*(?P<reviewer>[^·\n]+?)\s*·\s*Builder:\s*(?P<builder>[^·\n]+?)\s*·\s*"
    r"Reviewed:\s*\S+\s*@\s*(?P<sha>[0-9a-f]{7,40})\s*$", re.I)
WAIVER = re.compile(r"^waived by\s+(?P<who>[^,]*\S)\s*,\s*(?P<date>\d{4}-\d{2}-\d{2})\s*,\s*(?P<reason>\S.*)$", re.I)
OPEN_BLOCKING = re.compile(r"^\s*-\s*\[blocking\]", re.I | re.M)
# Reviewer and builder names map to the vendor family behind them, so product
# aliases ("GPT-6 Codex", "Anthropic Claude", "Claude Code") cannot pass as a
# different model. A name with no known family, or more than one, is rejected.
FAMILIES = {
    "anthropic": ("anthropic", "claude", "opus", "sonnet", "haiku", "fable"),
    "openai": ("openai", "codex", "chatgpt", "gpt"),
    "google": ("google", "gemini", "bard"),
}


def model_family(name):
    words = set(re.findall(r"[a-z]+", name.lower()))
    found = {family for family, aliases in FAMILIES.items() if words & set(aliases)}
    return found.pop() if len(found) == 1 else None


def git(repository, *args):
    return subprocess.run(["git", "-C", repository, *args], capture_output=True, text=True)


def verdict(text):
    section = re.search(r"^##\s*Verdict\s*$\n(?P<body>.*?)(?=^##\s|\Z)", text, re.M | re.S)
    lines = [line.strip() for line in (section.group("body") if section else "").splitlines() if line.strip()]
    return lines[0] if lines else ""


def review_lines(text):
    """Return the review lines from the opening block, or a problem."""
    opening = re.split(r"^##\s", text, maxsplit=1, flags=re.M)[0]
    found = []
    for line in opening.splitlines():
        if not re.match(r"^\s*Reviewer:", line, re.I):
            continue
        match = REVIEW_LINE.match(line.strip())
        if not match:
            return None, f"malformed review line: {line.strip()[:80]}"
        found.append(match)
    if not found:
        return None, "missing the Reviewer · Builder · Reviewed line"
    pairs = set()
    for match in found:
        reviewer, builder = model_family(match.group("reviewer")), model_family(match.group("builder"))
        if not reviewer or not builder:
            return None, "a review line names a model outside the known families"
        if reviewer == builder:
            return None, "a review line names the same model family as reviewer and builder"
        pairs.add((reviewer, builder))
    if len(pairs) > 1:
        return None, "review lines disagree on the reviewer or builder"
    return [m.group("sha") for m in found], None


def receipt_problem(text):
    state = verdict(text)
    waiver = WAIVER.match(state)
    if state.lower().startswith("waived"):
        if not waiver:
            return "a waiver needs `waived by <user>, <YYYY-MM-DD>, <reason>`"
        try:
            dt.date.fromisoformat(waiver.group("date"))
        except ValueError:
            return "the waiver date is not a real date"
        return None
    if state.lower() != "approve":
        return f"verdict is {state or 'missing'}"
    if OPEN_BLOCKING.search(text):
        return "approve with an open blocking finding"
    return None


def approved_commits(repository, receipts):
    covered, notes = [], []
    for path in sorted(pathlib.Path(receipts).glob("*/review.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        shas, problem = review_lines(text)
        problem = problem or receipt_problem(text)
        if problem:
            notes.append(f"{path.parent.name}: {problem}")
            continue
        for sha in shas:
            resolved = git(repository, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}")
            if resolved.returncode == 0:
                covered.append(resolved.stdout.strip())
            else:
                notes.append(f"{path.parent.name}: reviewed commit {sha} is not in this checkout")
    return covered, notes


def clean_merge(repository, commit):
    parents = git(repository, "rev-list", "--parents", "-n", "1", commit).stdout.split()[1:]
    if len(parents) != 2:
        return False
    merged = git(repository, "merge-tree", "--write-tree", "--no-messages", *parents)
    tree = git(repository, "rev-parse", f"{commit}^{{tree}}").stdout.strip()
    return merged.returncode == 0 and merged.stdout.split()[:1] == [tree]


def unreviewed(repository, active, target, covered):
    listed = git(repository, "rev-list", f"{active}..{target}")
    if listed.returncode != 0:
        raise SystemExit(f"Review gate stopped: cannot list commits {active}..{target}: {listed.stderr.strip()}")
    merges = set(git(repository, "rev-list", "--merges", f"{active}..{target}").stdout.split())
    covered = set(covered)
    missing = []
    for commit in listed.stdout.split():
        if commit in covered:
            continue
        if commit in merges and clean_merge(repository, commit):
            continue
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
