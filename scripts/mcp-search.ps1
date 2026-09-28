# Reusable MCP web search helper (ASCII only to avoid PS 5.1 encoding issues)
# Usage: powershell -File mcp-search.ps1 -Query "..." -Out "path" [-Recency oneYear] [-Location cn]
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Recency = 'noLimit',
    [string]$Location = 'cn'
)

$ErrorActionPreference = 'Continue'
$cfg = Get-Content 'C:\Users\BloodyCrown\.zcode\cli\config.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$key = $cfg.mcp.servers.'web-search-prime'.headers.Authorization
$url = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'

$baseHeaders = @{
    'Authorization' = $key
    'Content-Type'  = 'application/json'
    'Accept'        = 'application/json, text/event-stream'
}

$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}'
$r = Invoke-WebRequest -Uri $url -Method Post -Headers $baseHeaders -Body $init -TimeoutSec 40 -UseBasicParsing
$sid = $r.Headers['Mcp-Session-Id']
if ($sid -is [array]) { $sid = $sid[0] }

$sessHeaders = @{
    'Authorization'  = $key
    'Content-Type'   = 'application/json'
    'Accept'         = 'application/json, text/event-stream'
    'Mcp-Session-Id' = $sid
}
Invoke-WebRequest -Uri $url -Method Post -Headers $sessHeaders -Body '{"jsonrpc":"2.0","method":"notifications/initialized"}' -TimeoutSec 40 -UseBasicParsing | Out-Null

$args = @{ search_query = $Query; content_size = 'high'; location = $Location; search_recency_filter = $Recency }
$payload = @{ jsonrpc = '2.0'; id = 9; method = 'tools/call'; params = @{ name = 'web_search_prime'; arguments = $args } } | ConvertTo-Json -Depth 8 -Compress

$resp = Invoke-WebRequest -Uri $url -Method Post -Headers $sessHeaders -Body $payload -TimeoutSec 120 -UseBasicParsing
$text = $resp.Content
# Strip SSE framing, keep the data line
$line = ($text -split "`n" | Where-Object { $_ -like 'data:*' } | Select-Object -First 1)
if ($line) { $json = $line.Substring(5).Trim() } else { $json = $text }
[System.IO.File]::WriteAllText($Out, $json, [System.Text.Encoding]::UTF8)
Write-Output ('saved ' + $Out + ' len=' + $json.Length)
