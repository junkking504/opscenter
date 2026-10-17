#!/usr/bin/env python3
"""Write a nightly digest of OpsCenter work into the Obsidian vault Inbox.

Reads only local files and Git: production commits, the active release, task
notes in vault/Tasks, deploy evidence in task-evidence, and vault notes changed
in the last day. It writes vault/Inbox/Digest YYYY-MM-DD.md for a person or agent
to promote into Decisions/ or Lessons/. It calls no external service and never
copies note or log contents, only titles, verdicts and links.
"""
import argparse
import datetime as dt
import os
import pathlib
import re
import subprocess
import sys

WORKSPACE = pathlib.Path("/Users/missioncontrol/opscenter-v2")
MEMORY_FOLDERS = ("Decisions", "Lessons", "Knowledge", "Systems")


def changed_since(root, pattern, since):
    if not root.is_dir():
        return []
    return sorted(path for path in root.glob(pattern) if path.is_file() and path.stat().st_mtime >= since)


def git(repository, *args):
    result = subprocess.run(["git", "-C", str(repository), *args], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def verdict(path):
    match = re.search(r"^##\s*Verdict\s*$\n+\s*(\S[^\n]*)", path.read_text(encoding="utf-8", errors="replace"), re.M)
    return match.group(1).strip() if match else "no verdict"


def link(vault, path):
    return f"[[{path.relative_to(vault).with_suffix('').as_posix()}]]"


def digest(workspace, vault, repository, day, since):
    lines = [f"# Digest {day.isoformat()}", "", "Automatic nightly summary. Promote anything worth keeping into a Decisions/ or Lessons/ note, then delete this digest.", ""]

    active = pathlib.Path(os.path.realpath(workspace / "opscenter")).name
    lines += ["## Production", "", f"- Active release: `{active[:12]}`"]
    git(repository, "fetch", "--quiet", "origin", "production")
    commits = git(repository, "log", "--no-merges", f"--since=@{int(since)}", "--format=- `%h` %s (%an)", "origin/production")
    lines += [commits] if commits else ["- No new production commits."]
    lines.append("")

    tasks = changed_since(vault / "Tasks", "*/*.md", since)
    lines += ["## Task notes", ""]
    for path in tasks:
        suffix = f": {verdict(path)}" if path.name == "review.md" else ""
        lines.append(f"- {link(vault, path)}{suffix}")
    if not tasks:
        lines.append("- No briefs, handoffs or reviews changed.")
    lines.append("")

    evidence = changed_since(workspace / "task-evidence", "*/verification.md", since)
    lines += ["## Deploy evidence", ""]
    lines += [f"- `task-evidence/{path.parent.name}/verification.md`" for path in evidence] or ["- No verification records changed."]
    lines.append("")

    notes = [path for folder in MEMORY_FOLDERS for path in changed_since(vault / folder, "**/*.md", since) if path.name != "README.md"]
    lines += ["## Memory notes changed", ""]
    lines += [f"- {link(vault, path)}" for path in notes] or ["- None."]
    lines.append("")

    unreviewed = [path.parent for path in changed_since(vault / "Tasks", "*/handoff.md", since) if not (path.parent / "review.md").exists()]
    if unreviewed:
        lines += ["## Waiting on review", ""]
        lines += [f"- {link(vault, folder / 'handoff.md')} has a handoff but no review.md" for folder in unreviewed]
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=pathlib.Path, default=WORKSPACE)
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--date", type=dt.date.fromisoformat, default=dt.date.today())
    parser.add_argument("--force", action="store_true", help="replace an existing digest for the date")
    args = parser.parse_args()
    vault = args.workspace / "vault"
    if not (vault / "Home.md").is_file():
        print(f"vault digest stopped: no vault at {vault}", file=sys.stderr)
        return 1
    target = vault / "Inbox" / f"Digest {args.date.isoformat()}.md"
    if target.exists() and not args.force:
        print(f"vault digest skipped: {target.name} already exists")
        return 0
    since = dt.datetime.now().timestamp() - args.hours * 3600
    text = digest(args.workspace, vault, args.workspace / "repository", args.date, since)
    temporary = target.with_suffix(".md.tmp")
    temporary.write_text(text + "\n", encoding="utf-8")
    temporary.replace(target)
    print(f"vault digest wrote {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
