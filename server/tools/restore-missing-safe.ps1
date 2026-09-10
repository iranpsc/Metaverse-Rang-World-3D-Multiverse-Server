# restore-missing-safe.ps1
# Restore only missing paths, but skip 0KB files from backup.

param(
  [string]$Zip = ".\BACKUP_before_cleanup_20260225_032858.zip"
)

$root = Get-Location
$zipPath = Join-Path $root $Zip
if (!(Test-Path $zipPath)) { Write-Error "Backup zip not found: $zipPath"; exit 1 }

$missing = @(
  "protos\common\common.proto",
  "protos\common\user.proto",
  "protos\auth\auth.proto",
  "protos\realtime\realtime.proto",
  "protos\health.proto",
  "src\config\validation.js",
  "src\utils\ids.js",
  "src\utils\metrics.js",
  "src\realtime\index.js",
  "src\realtime\wsAuth.js",
  "src\realtime\clientsRegistry.js",
  "src\realtime\roomManager.js",
  "src\realtime\protocol\envelope.js",
  "src\realtime\protocol\channels.js",
  "src\realtime\router\realtimeRouter.js",
  "src\realtime\router\presenceRoutes.js",
  "src\realtime\router\worldRoutes.js",
  "src\realtime\router\npcRoutes.js",
  "src\realtime\router\systemRoutes.js",
  "src\realtime\router\voiceSignalRoutes.js",
  "src\realtime\stability\heartbeat.js",
  "src\realtime\stability\disconnectCleanup.js",
  "src\realtime\stability\floodProtection.js",
  "src\voice\docs\voice-architecture.md",
  "src\voice\webrtc\stunTurnConfig.js",
  "src\voice\webrtc\sfuAdapter.js",
  "src\test\basic-test.js",
  "src\test\bench\presence-load.js",
  "src\test\bench\world-broadcast.js",
  "src\test\bench\npc-push.js",
  "src\test\bench\voice-signal.js",
  "certs\localhost.pem",
  "certs\localhost-key.pem",
  "scripts\mkcert-dev.ps1",
  "scripts\create-realtime-skeleton.ps1",
  ".env.example"
)

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

$tmp = Join-Path $root ("__restore_tmp_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
Ensure-Dir $tmp
Write-Host "Extracting backup to: $tmp"
Expand-Archive -LiteralPath $zipPath -DestinationPath $tmp -Force

$restored = 0; $skipped = 0; $notFound = 0; $skippedZero = 0

foreach ($rel in $missing) {
  $src = Join-Path $tmp $rel
  $dst = Join-Path $root $rel

  if (Test-Path $dst) { Write-Host "SKIP (exists): $rel"; $skipped++; continue }
  if (!(Test-Path $src)) { Write-Host "NOT IN ZIP: $rel"; $notFound++; continue }

  $item = Get-Item -LiteralPath $src
  if (-not $item.PSIsContainer -and $item.Length -eq 0) {
    Write-Host "SKIP (0KB in zip): $rel"
    $skippedZero++
    continue
  }

  Ensure-Dir (Split-Path $dst -Parent)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "RESTORE: $rel"
  $restored++
}

# cert copy fallback from envoy/certs
$envPem = Join-Path $root "envoy\certs\localhost.pem"
$envKey = Join-Path $root "envoy\certs\localhost-key.pem"
$certsDir = Join-Path $root "certs"

if (!(Test-Path (Join-Path $certsDir "localhost.pem")) -and (Test-Path $envPem)) {
  Ensure-Dir $certsDir
  Copy-Item -LiteralPath $envPem -Destination (Join-Path $certsDir "localhost.pem") -Force
  Write-Host "COPY CERT: envoy/certs/localhost.pem -> certs/localhost.pem"
}
if (!(Test-Path (Join-Path $certsDir "localhost-key.pem")) -and (Test-Path $envKey)) {
  Ensure-Dir $certsDir
  Copy-Item -LiteralPath $envKey -Destination (Join-Path $certsDir "localhost-key.pem") -Force
  Write-Host "COPY CERT: envoy/certs/localhost-key.pem -> certs/localhost-key.pem"
}

Write-Host ""
Write-Host "Done. Restored=$restored SkippedExists=$skipped Skipped0KB=$skippedZero NotInZip=$notFound"
Write-Host "Temp kept: $tmp"