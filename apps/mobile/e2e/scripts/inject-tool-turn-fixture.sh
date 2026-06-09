#!/usr/bin/env bash
# Inject tool-turn E2E fixture (host-side SQLite — no device sqlite3 binary).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${MOBILE_ROOT}"
node ./e2e/scripts/inject-tool-turn-fixture.mjs
