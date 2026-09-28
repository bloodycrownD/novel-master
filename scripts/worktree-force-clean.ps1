# Force-remove stale git worktree dirs on Windows.
# Plain "git worktree remove" often fails with "Directory not empty" because of
# node_modules deep paths / lingering handles. Fallback strategy:
#   robocopy /MIR an empty dir over the target to wipe its contents,
#   then remove the leftover root, then "git worktree prune" to clean metadata.
# NOTE (ASCII-only on purpose): PowerShell 5.1 decodes .ps1 as ANSI, non-ASCII
# comments can swallow the next code line - see docs/apm/RULE.md.
# Usage:
#   powershell -File scripts\worktree-force-clean.ps1 -Targets <dir1>,<dir2> [-Repo <repo-path>]
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Targets,
  [string]$Repo = 'D:\Dev\Js\novel-master'
)
$ErrorActionPreference = 'Continue'
$empty = Join-Path $env:TEMP ('nm-empty-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $empty | Out-Null
try {
  foreach ($p in $Targets) {
    if (Test-Path $p) {
      Write-Host "CLEANING $p"
      robocopy $empty $p /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path $p) { Write-Host "STILL-EXISTS $p" } else { Write-Host "REMOVED $p" }
    } else {
      Write-Host "ABSENT $p"
    }
  }
} finally {
  Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'PRUNE:'
git -C $Repo worktree prune
git -C $Repo worktree list
