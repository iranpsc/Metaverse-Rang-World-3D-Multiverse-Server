# create-realtime-skeleton.ps1
# Usage:
# powershell -ExecutionPolicy Bypass -File .\server\scripts\create-realtime-skeleton.ps1

$ErrorActionPreference = "Stop"

$root = "server"

# --- New directories to add on top of your existing gRPC skeleton ---
$dirs = @(
  "$root/protos/realtime",

  "$root/src/realtime",
  "$root/src/realtime/protocol",
  "$root/src/realtime/router",
  "$root/src/realtime/stability",

  "$root/src/voice",
  "$root/src/voice/docs",
  "$root/src/voice/webrtc",

  "$root/src/test/bench",

  "$root/src/utils" # already exists, but safe
)

# --- New files to add (only if missing) ---
$files = @(
  "$root/protos/realtime/realtime.proto",

  "$root/src/utils/ids.js",
  "$root/src/utils/metrics.js",

  "$root/src/realtime/index.js",
  "$root/src/realtime/wsAuth.js",
  "$root/src/realtime/clientsRegistry.js",
  "$root/src/realtime/roomManager.js",

  "$root/src/realtime/protocol/envelope.js",
  "$root/src/realtime/protocol/channels.js",

  "$root/src/realtime/router/realtimeRouter.js",
  "$root/src/realtime/router/presenceRoutes.js",
  "$root/src/realtime/router/worldRoutes.js",
  "$root/src/realtime/router/npcRoutes.js",
  "$root/src/realtime/router/systemRoutes.js",
  "$root/src/realtime/router/voiceSignalRoutes.js",

  "$root/src/realtime/stability/heartbeat.js",
  "$root/src/realtime/stability/disconnectCleanup.js",
  "$root/src/realtime/stability/floodProtection.js",

  "$root/src/voice/docs/voice-architecture.md",
  "$root/src/voice/webrtc/stunTurnConfig.js",
  "$root/src/voice/webrtc/sfuAdapter.js",

  "$root/src/test/bench/presence-load.js",
  "$root/src/test/bench/world-broadcast.js",
  "$root/src/test/bench/npc-push.js",
  "$root/src/test/bench/voice-signal.js"
)

Write-Host "Creating directories (only missing)..." -ForegroundColor Cyan
foreach ($d in $dirs) {
  if (!(Test-Path $d)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    Write-Host "  + $d"
  } else {
    Write-Host "  = $d (exists)"
  }
}

Write-Host "`nCreating files (only missing)..." -ForegroundColor Cyan
foreach ($f in $files) {
  $parent = Split-Path $f -Parent
  if (!(Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if (!(Test-Path $f)) {
    New-Item -ItemType File -Force -Path $f | Out-Null
    Write-Host "  + $f"
  } else {
    Write-Host "  = $f (exists)"
  }
}

Write-Host "`nDone! Realtime + Voice skeleton added on top of your existing structure." -ForegroundColor Green
Write-Host "Next: We'll fill implementations gradually (ws attach, router, heartbeat, etc.)."