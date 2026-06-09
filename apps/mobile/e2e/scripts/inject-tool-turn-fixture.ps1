# Inject tool-turn E2E fixture into the debug app's SQLite DB.
# Usage: from apps/mobile: .\e2e\scripts\inject-tool-turn-fixture.ps1

$ErrorActionPreference = 'Stop'
$Pkg = 'com.novelmaster'
$DbPath = "/data/data/$Pkg/files/default/novel_master_vfs"
$SqlLocal = Join-Path $PSScriptRoot '..\fixtures\tool-turn-session.sql'
$SqlRemote = '/data/local/tmp/e2e-fixture.sql'

if (-not (Test-Path $SqlLocal)) {
  throw "Fixture SQL not found: $SqlLocal"
}

Write-Host "[e2e] Force-stopping $Pkg..."
adb shell am force-stop $Pkg

Write-Host "[e2e] Pushing fixture SQL..."
adb push $SqlLocal $SqlRemote

Write-Host "[e2e] Applying SQL to $DbPath..."
adb shell "cat $SqlRemote | run-as $Pkg sqlite3 $DbPath"
adb shell rm $SqlRemote

Write-Host "[e2e] Fixture injected. Launch app and open session 'E2E Tool Turn Fixture'."
