$ErrorActionPreference = "Stop"

$sec = Read-Host "Now copy the Discord Bot Token from the browser and paste it here (hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ($plain.Length -lt 40) {
  Write-Error "That looks too short to be a Discord Bot Token ($($plain.Length) chars). Run .\scripts\set-discord-token.ps1 again."
  exit 1
}

# Verify token against Discord REST API without printing the token
try {
  $me = Invoke-RestMethod -Uri "https://discord.com/api/v10/users/@me" -Headers @{ Authorization = "Bot $plain" } -Method Get
  Write-Host "Verified Discord Bot: $($me.username) (ID: $($me.id))" -ForegroundColor Green
} catch {
  Write-Error "Discord rejected that token (make sure you copied the newly reset Bot Token). Run .\scripts\set-discord-token.ps1 again."
  exit 1
}

$tmp = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllBytes($tmp, [System.Text.Encoding]::UTF8.GetBytes($plain))
  gcloud.cmd secrets versions add DISCORD_BOT_TOKEN --data-file="$tmp" --project=studio-4236902803-1eba2
  Write-Host "Saved DISCORD_BOT_TOKEN to GCP Secret Manager!" -ForegroundColor Green
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Force }
  $plain = $null
}
