$ErrorActionPreference = "Continue"
$CLI = "d:\Dev\Js\novel-master\apps\cli\dist\index.js"
$DIR = "C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-test-20260530-v2"
New-Item -ItemType Directory -Path $DIR -Force | Out-Null
$DB = Join-Path $DIR "novel.db"
if (Test-Path $DB) { Remove-Item $DB -Force }
$PROMPT = Join-Path $DIR "prompt.yaml"
@"
blocks:
  chat:
    type: chat
"@ | Set-Content -Path $PROMPT -Encoding UTF8

function Invoke-Nm([string[]]$NmArgs) {
  $proc = Start-Process -FilePath "node" -ArgumentList (@($CLI) + $NmArgs) -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput "$env:TEMP\nm-out.txt" -RedirectStandardError "$env:TEMP\nm-err.txt"
  $stdout = Get-Content "$env:TEMP\nm-out.txt" -Raw -ErrorAction SilentlyContinue
  $stderr = Get-Content "$env:TEMP\nm-err.txt" -Raw -ErrorAction SilentlyContinue
  if ($null -eq $stdout) { $stdout = "" }
  if ($null -eq $stderr) { $stderr = "" }
  return @{ Exit = $proc.ExitCode; Out = $stdout; Err = $stderr }
}

function Section($name, $cmd, $result) {
  Write-Output "@@@SECTION:$name@@@"
  Write-Output "@@@CMD:$cmd@@@"
  Write-Output "@@@EXIT:$($result.Exit)@@@"
  Write-Output "@@@STDOUT_START@@@"
  Write-Output $result.Out
  Write-Output "@@@STDOUT_END@@@"
  if ($result.Err.Trim().Length -gt 0) {
    Write-Output "@@@STDERR_START@@@"
    Write-Output $result.Err
    Write-Output "@@@STDERR_END@@@"
  }
}

Write-Output "@@@META:WORKDIR=$DIR@@@"
Write-Output "@@@META:DB=$DB@@@"
Write-Output "@@@META:PROMPT=$PROMPT@@@"

$r = Invoke-Nm @("project","create","--name","RegexCliTest","--db",$DB)
Section "01-project-create" "nm project create --name RegexCliTest --db $DB" $r
$projectId = $r.Out.Trim()

$r = Invoke-Nm @("project","use","--project",$projectId,"--db",$DB)
Section "02-project-use" "nm project use --project $projectId --db $DB" $r

$r = Invoke-Nm @("session","create","--project",$projectId,"--db",$DB)
Section "03-session-create" "nm session create --project $projectId --db $DB" $r
$sessionId = $r.Out.Trim()

$r = Invoke-Nm @("session","use","--session",$sessionId,"--db",$DB)
Section "04-session-use" "nm session use --session $sessionId --db $DB" $r

$r = Invoke-Nm @("regex-group","create","strict-filter","--displayName","strict-mask","--db",$DB)
Section "05-regex-group-create" "nm regex-group create strict-filter --displayName strict-mask --db $DB" $r

$r = Invoke-Nm @("regex-group","use","strict-filter","--db",$DB)
Section "06-regex-group-use" "nm regex-group use strict-filter --db $DB" $r

$r = Invoke-Nm @("regex-group","current","--db",$DB)
Section "07-regex-group-current" "nm regex-group current --db $DB" $r

$r = Invoke-Nm @("regex","create","--regexGroup","strict-filter","--regexId","mask-email","--name","mask-email","--pattern","[\w.-]+@[\w.-]+\.[A-Za-z]{2,}","--llmReplace","[redacted]","--displayReplace","***","--minDepth","1","--maxDepth","99","--user","--assistant","--db",$DB)
Section "08-regex-create-full" "nm regex create --regexGroup strict-filter --regexId mask-email ... (llm+display+user+assistant)" $r

$r = Invoke-Nm @("regex","list","--regexGroup","strict-filter","--db",$DB)
Section "09-regex-list" "nm regex list --regexGroup strict-filter --db $DB" $r

$r = Invoke-Nm @("message","append","--session",$sessionId,"--role","user","--content","contact: mysecret@email.com today","--db",$DB)
Section "10-message-append" "nm message append --session $sessionId --role user --content 'contact: mysecret@email.com today' --db $DB" $r

$r = Invoke-Nm @("message","list","--session",$sessionId,"--db",$DB)
Section "11-message-list-display-channel" "nm message list --session $sessionId --db $DB (display channel)" $r

$r = Invoke-Nm @("prompt","render","--path",$PROMPT,"--project",$projectId,"--session",$sessionId,"--db",$DB)
Section "12-prompt-render-llm-channel" "nm prompt render --path $PROMPT --project $projectId --session $sessionId --db $DB (llm channel)" $r

$r = Invoke-Nm @("regex","test","--regexGroup","strict-filter","--regexId","mask-email","--text","mysecret@email.com","--floor","1","--role","user","--channel","display","--db",$DB)
Section "13-regex-test-display" "nm regex test --regexGroup strict-filter --regexId mask-email --channel display --text mysecret@email.com --db $DB" $r

$r = Invoke-Nm @("regex","test","--regexGroup","strict-filter","--regexId","mask-email","--text","mysecret@email.com","--floor","1","--role","user","--channel","llm","--db",$DB)
Section "14-regex-test-llm" "nm regex test --regexGroup strict-filter --regexId mask-email --channel llm --text mysecret@email.com --db $DB" $r

$r = Invoke-Nm @("regex","create","--regexGroup","strict-filter","--regexId","bad","--name","bad","--pattern","[","--minDepth","1","--maxDepth","2","--user","--displayReplace","x","--db",$DB)
Section "15-regex-create-invalid-pattern" "nm regex create invalid pattern /[/ (expect fail)" $r

$r = Invoke-Nm @("regex","test","--regexGroup","strict-filter","--regexId","mask-email","--text","hello","--floor","1","--role","user","--db",$DB)
Section "16-regex-test-no-channel" "nm regex test without --channel (expect fail)" $r

# C6: display-only — list masked, prompt not
if (Test-Path $DB) { Remove-Item $DB -Force }
$r = Invoke-Nm @("project","create","--name","RegexC6","--db",$DB)
$projectC6 = $r.Out.Trim()
$r = Invoke-Nm @("session","create","--project",$projectC6,"--db",$DB)
$sessionC6 = $r.Out.Trim()
Invoke-Nm @("message","append","--session",$sessionC6,"--role","user","--content","mysecret@email.com","--db",$DB) | Out-Null
Invoke-Nm @("regex-group","create","filter","--db",$DB) | Out-Null
Invoke-Nm @("regex-group","use","filter","--db",$DB) | Out-Null
Invoke-Nm @("regex","create","--regexGroup","filter","--regexId","mask","--name","mask","--pattern","secret","--displayReplace","***","--minDepth","1","--maxDepth","99","--user","--db",$DB) | Out-Null
$r = Invoke-Nm @("message","list","--session",$sessionC6,"--db",$DB)
Section "17-c6-message-list-display-only" "C6: display-only rule — nm message list (expect ***)" $r
$r = Invoke-Nm @("prompt","render","--path",$PROMPT,"--project",$projectC6,"--session",$sessionC6,"--db",$DB)
Section "18-c6-prompt-render-display-only" "C6: display-only rule — nm prompt render (expect secret unchanged)" $r

# C5: llm-only — prompt masked, list not
if (Test-Path $DB) { Remove-Item $DB -Force }
$r = Invoke-Nm @("project","create","--name","RegexC5","--db",$DB)
$projectC5 = $r.Out.Trim()
$r = Invoke-Nm @("session","create","--project",$projectC5,"--db",$DB)
$sessionC5 = $r.Out.Trim()
Invoke-Nm @("message","append","--session",$sessionC5,"--role","user","--content","mysecret word","--db",$DB) | Out-Null
Invoke-Nm @("regex-group","create","llm-filter","--db",$DB) | Out-Null
Invoke-Nm @("regex-group","use","llm-filter","--db",$DB) | Out-Null
Invoke-Nm @("regex","create","--regexGroup","llm-filter","--regexId","r1","--name","r1","--pattern","secret","--llmReplace","[redacted]","--minDepth","1","--maxDepth","99","--user","--db",$DB) | Out-Null
$r = Invoke-Nm @("message","list","--session",$sessionC5,"--db",$DB)
Section "19-c5-message-list-llm-only" "C5: llm-only rule — nm message list (expect secret visible)" $r
$r = Invoke-Nm @("prompt","render","--path",$PROMPT,"--project",$projectC5,"--session",$sessionC5,"--db",$DB)
Section "20-c5-prompt-render-llm-only" "C5: llm-only rule — nm prompt render (expect [redacted])" $r

# pointer reset on delete (fresh db)
if (Test-Path $DB) { Remove-Item $DB -Force }
Invoke-Nm @("regex-group","create","g1","--db",$DB) | Out-Null
Invoke-Nm @("regex-group","use","g1","--db",$DB) | Out-Null
$r = Invoke-Nm @("regex-group","delete","g1","--db",$DB)
Section "21-regex-group-delete" "nm regex-group delete g1 --db $DB" $r
$r = Invoke-Nm @("regex-group","current","--db",$DB)
Section "22-regex-group-current-after-delete" "nm regex-group current after delete (expect fail)" $r
