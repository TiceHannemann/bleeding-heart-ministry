# Sends the history of Terra Nostra (the JSON written from the Discord archives) to the Ministry server,
# where it appears in the Briefing Room as "History". Sending it again replaces it.
# Usage:  .\tools\send-history.ps1 -File "C:\Users\you\discord-exports\history\terra-nostra-history.json" -Server "http://YOUR-VPS-IP:8080" -Token "your CHAT_UPLOAD_TOKEN"
param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$Token
)
$body = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $File))
$r = Invoke-RestMethod -Method Post -Uri ($Server.TrimEnd('/') + "/api/history-import") -Headers @{ "x-chat-token" = $Token } -ContentType "application/json; charset=utf-8" -Body $body
Write-Host "$($r.message) ($($r.chapters) chapters, $($r.events) dated events, as of $($r.asOf))"
