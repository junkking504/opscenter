#!/bin/bash
set -euo pipefail
cd "${HOME:?}/opscenter-v2/opscenter"
exec python3 scripts/run-address-verification-agent.py "$@"
