#!/usr/bin/env bash
# Inject tool-turn E2E fixture into the debug app's SQLite DB.
# Usage: from apps/mobile: ./e2e/scripts/inject-tool-turn-fixture.sh
set -euo pipefail

PKG=com.novelmaster
DB_PATH="/data/data/${PKG}/files/default/novel_master_vfs"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_LOCAL="${SCRIPT_DIR}/../fixtures/tool-turn-session.sql"
SQL_REMOTE=/data/local/tmp/e2e-fixture.sql

if [[ ! -f "$SQL_LOCAL" ]]; then
  echo "[e2e] Fixture SQL not found: $SQL_LOCAL" >&2
  exit 1
fi

echo "[e2e] Force-stopping ${PKG}..."
adb shell am force-stop "$PKG"

echo "[e2e] Pushing fixture SQL..."
adb push "$SQL_LOCAL" "$SQL_REMOTE"

echo "[e2e] Applying SQL to ${DB_PATH}..."
adb shell "cat ${SQL_REMOTE} | run-as ${PKG} sqlite3 ${DB_PATH}"
adb shell rm "$SQL_REMOTE"

echo "[e2e] Fixture injected. Launch app and open session 'E2E Tool Turn Fixture'."
