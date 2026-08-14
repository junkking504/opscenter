# OpsCenter Business Share

This directory contains the reviewed, secret-free context intended for a
ChatGPT Business project. The generated bundle also includes selected source
documentation and an optional source archive.

## Use

1. Run `./scripts/build-business-share-bundle.sh` from a clean checkout.
2. Review the generated manifest and every readable file.
3. Upload the readable files to the ChatGPT Business project named
   **OpsCenter**.
4. Paste `PROJECT_INSTRUCTIONS.md` into the project's instructions.
5. Share the project with the intended workspace members or group.
6. Use the private Git repository—not ChatGPT file uploads—for complete source
   editing, pull requests, and code review.

## Safety

The package intentionally excludes live OpsBot data, logs, credentials,
environment files, browser state, releases, previews, worktrees, caches,
databases, employee/payroll detail, customer records, and financial exports.
