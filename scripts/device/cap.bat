@echo off
rem Usage: cap.bat <outdir> <maxframes>  -- stop early: create <outdir>\stop
setlocal
set ADB=C:\Users\BloodyCrown\AppData\Local\Android\Sdk\platform-tools\adb.exe
set DEV=DSLDU20407006179
set OUT=%~1
set MAX=%~2
mkdir "%OUT%" 2>nul
del "%OUT%\stop" 2>nul
if exist "%OUT%\ts.txt" del "%OUT%\ts.txt"
for /L %%i in (0,1,%MAX%) do (
  if exist "%OUT%\stop" goto :done
  "%ADB%" -s %DEV% exec-out screencap -p > "%OUT%\f%%i.png"
  echo %%i %time% >> "%OUT%\ts.txt"
)
:done
echo capture-done %time%
