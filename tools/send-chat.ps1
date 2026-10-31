# Sends DiscordChatExporter JSON files to the Ministry server, which reads them at its next hourly run.
# Usage:  .\tools\send-chat.ps1 -Folder "C:\Users\you\discord-exports\last12h" -Server "http://YOUR-VPS-IP:8080" -Token "your CHAT_UPLOAD_TOKEN"
# Sent files move into a "sent" folder beside them, so running it again only sends new exports.
param(
  [Parameter(Mandatory=$true)][string]$Folder,
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$Token
)
$sent = Join-Path $Folder "sent"
New-Item -ItemType Directory -Force $sent | Out-Null
$files = Get-ChildItem -LiteralPath $Folder -Filter *.json -File
foreach ($f in $files) {
  try {
    $body = [System.IO.File]::ReadAllBytes($f.FullName)
    $r = Invoke-RestMethod -Method Post -Uri ($Server.TrimEnd('/') + "/api/chat-import") -Headers @{ "x-chat-token" = $Token } -ContentType "application/json; charset=utf-8" -Body $body
    Move-Item -LiteralPath $f.FullName -Destination $sent -Force
    Write-Host "sent  $($f.Name)  ($($r.messages) messages)"
  } catch {
    Write-Host "FAILED  $($f.Name): $($_.Exception.Message)"
  }
}
Write-Host "$($files.Count) file(s) processed."
