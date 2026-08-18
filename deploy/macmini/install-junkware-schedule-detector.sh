#!/bin/bash
set -Eeuo pipefail

exec "$(cd "$(dirname "$0")" && pwd)/install-junkware-schedule-watchers.sh"
