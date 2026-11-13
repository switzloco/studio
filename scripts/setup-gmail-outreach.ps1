$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot ".env.local"
$ProjectId = "studio-4236902803-1eba2"
$GmailUser = "nicholas.switzer@gmail.com"

Write-Host ""
Write-Host "=== CFO Outreach: Gmail App Password Setup ===" -ForegroundColor Cyan
Write-Host "1. Open https://myaccount.google.com/apppasswords (signed in as $GmailUser)"
Write-Host "2. Type 'the CFO' as the App name and click Create"
Write-Host "3. Copy the 16-letter code (spaces are fine)"
Write-Host ""
Write-Host "NOTE: Nothing appears while you paste below. Paste once, then press ENTER." -ForegroundColor Yellow

$sec = Read-Host "Paste 16-letter Google App Password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$rawPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$cleanPass = ($rawPass -replace "\s+", "")
Remove-Variable rawPass, sec -ErrorAction SilentlyContinue

if ($cleanPass.Length -lt 12) {
  Write-Host "ERROR: Password looked empty or too short ($($cleanPass.Length) chars). Re-run and paste your 16-letter App Password, then press Enter." -ForegroundColor Red
  Remove-Variable cleanPass -ErrorAction SilentlyContinue
  exit 1
}

# 1. Update .env.local safely without echoing the secret
if (Test-Path $EnvFile) {
  $lines = Get-Content $EnvFile | Where-Object {
    $_ -notmatch "^GMAIL_APP_PASSWORD=" -and $_ -notmatch "^GMAIL_USER="
  }
  Set-Content -Path $EnvFile -Value $lines -Encoding UTF8
}
Add-Content -Path $EnvFile -Value "GMAIL_USER=$GmailUser" -Encoding UTF8
Add-Content -Path $EnvFile -Value "GMAIL_APP_PASSWORD=$cleanPass" -Encoding UTF8
Write-Host "[1/3] Saved GMAIL_USER and GMAIL_APP_PASSWORD to .env.local." -ForegroundColor Green

# 2. Save to GCP Secret Manager & grant Firebase App Hosting IAM access
$tmpFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tmpFile, $cleanPass, (New-Object System.Text.UTF8Encoding($false)))
  Remove-Variable cleanPass -ErrorAction SilentlyContinue

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $existingNames = gcloud.cmd secrets list --project=$ProjectId --format="value(name)" 2>$null
  if ($existingNames -notcontains "GMAIL_APP_PASSWORD") {
    gcloud.cmd secrets create GMAIL_APP_PASSWORD --replication-policy="automatic" --project=$ProjectId 2>$null | Out-Null
  }
  gcloud.cmd secrets versions add GMAIL_APP_PASSWORD --data-file=$tmpFile --project=$ProjectId 2>$null | Out-Null

  # Grant Firebase App Hosting runtime & service agent roles matching CRON_SECRET
  gcloud.cmd secrets add-iam-policy-binding GMAIL_APP_PASSWORD `
    --project=$ProjectId `
    --member="serviceAccount:firebase-app-hosting-compute@studio-4236902803-1eba2.iam.gserviceaccount.com" `
    --role="roles/secretmanager.secretAccessor" 2>$null | Out-Null

  gcloud.cmd secrets add-iam-policy-binding GMAIL_APP_PASSWORD `
    --project=$ProjectId `
    --member="serviceAccount:firebase-app-hosting-compute@studio-4236902803-1eba2.iam.gserviceaccount.com" `
    --role="roles/secretmanager.viewer" 2>$null | Out-Null

  gcloud.cmd secrets add-iam-policy-binding GMAIL_APP_PASSWORD `
    --project=$ProjectId `
    --member="serviceAccount:service-473903412658@gcp-sa-firebaseapphosting.iam.gserviceaccount.com" `
    --role="roles/secretmanager.secretVersionManager" 2>$null | Out-Null
  $ErrorActionPreference = $prevEap

  Write-Host "[2/3] Stored GMAIL_APP_PASSWORD in GCP Secret Manager + granted App Hosting access." -ForegroundColor Green
} finally {
  if (Test-Path $tmpFile) {
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
  }
}

# 3. Enroll & immediately dispatch live welcome emails to both accounts
Write-Host "[3/3] Sending live welcome briefings to nicholas.switzer@gmail.com and srswitzer@gmail.com..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
  npx tsx scripts/enroll-outreach.ts nicholas.switzer@gmail.com srswitzer@gmail.com
} finally {
  Pop-Location
}
