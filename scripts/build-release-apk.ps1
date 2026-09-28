# Build a REAL release-variant APK (release config + debug keystore override)
# to verify the CI release form starts correctly. No MainApplication patch needed:
# release build sets useDevSupport = BuildConfig.DEBUG = false naturally.
$ErrorActionPreference = 'Stop'
$repo = 'D:\Dev\Js\novel-master'
Set-Location -LiteralPath (Join-Path $repo 'apps\mobile')

# 1) webview assets must exist before gradle (preBuild guard)
& npm run build:webview:native
if ($LASTEXITCODE -ne 0) { throw ('WEBVIEW_FAILED ' + $LASTEXITCODE) }
Write-Output 'WEBVIEW_NATIVE_OK'

# 2) assembleRelease with debug keystore injected via properties
#    (dotted -P args through PowerShell get mangled -> go through cmd /c)
& cmd /c "cd /d D:\Dev\Js\novel-master\apps\mobile\android && gradlew.bat assembleRelease -PversionCode=1318 -PversionName=1.5.25-rc2 -Pandroid.injected.signing.store.file=D:\Dev\Js\novel-master\apps\mobile\android\app\debug.keystore -Pandroid.injected.signing.store.password=android -Pandroid.injected.signing.key.alias=androiddebugkey -Pandroid.injected.signing.key.password=android"
if ($LASTEXITCODE -ne 0) { throw ('GRADLE_FAILED ' + $LASTEXITCODE) }
Write-Output 'GRADLE_OK'

Set-Location -LiteralPath $repo
$apk = Join-Path $repo 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk'
$f = Get-Item $apk
Write-Output ('APK=' + $apk + ' SIZE=' + $f.Length + ' MTIME=' + $f.LastWriteTime)
