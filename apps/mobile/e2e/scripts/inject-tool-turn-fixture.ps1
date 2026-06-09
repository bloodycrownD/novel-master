# Inject tool-turn E2E fixture (host-side SQLite — no device sqlite3 binary).
# Usage: from repo root: npm run mobile:e2e:fixture
#        or from apps/mobile: npm run e2e:fixture

$ErrorActionPreference = 'Stop'
$MobileRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $MobileRoot
node ./e2e/scripts/inject-tool-turn-fixture.mjs
