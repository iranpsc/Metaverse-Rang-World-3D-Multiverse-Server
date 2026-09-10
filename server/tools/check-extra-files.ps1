# check-extra-files.ps1
# هدف: فقط Extra واقعی نسبت به ساختار مرجع
# - node_modules و __restore_tmp_* ignore
# - فولدرهای مجاز (src/protos/envoy/certs/scripts) extra حساب نمی‌شوند
# - فقط FILEها extra حساب می‌شوند

Write-Host "SCRIPT_STARTED"
$root = Get-Location
Write-Host ("PWD=" + $root)
Write-Host "============================================================"

function IsIgnoredRel([string]$rel) {
  if ($rel -eq "node_modules" -or $rel -like "node_modules\*") { return $true }
  if ($rel -like "__restore_tmp_*" -or $rel -like "__restore_tmp_*\*") { return $true }
  return $false
}

# فولدرهای مجاز در روت
$allowedRootDirs = @("src","protos","envoy","certs","scripts","node_modules")
# فایل‌های مجاز در روت
$allowedRootFiles = @("package.json","package-lock.json","README.md",".env",".env.example")

# allowlist دقیق فایل‌ها (مرجع)
$allowExact = @(
  # root files
  "package.json",
  "package-lock.json",
  "README.md",
  ".env",
  ".env.example",

  # certs
  "certs\localhost.pem",
  "certs\localhost-key.pem",

  # envoy
  "envoy\envoy.yaml",

  # scripts
  "scripts\mkcert-dev.ps1",
  "scripts\create-realtime-skeleton.ps1",

  # protos
  "protos\common\common.proto",
  "protos\common\user.proto",
  "protos\auth\auth.proto",
  "protos\realtime\realtime.proto",
  "protos\health.proto",

  # src root
  "src\index.js",
  "src\shutdown.js",

  # src/config
  "src\config\env.js",
  "src\config\tls.js",
  "src\config\validation.js",

  # src/utils
  "src\utils\logger.js",
  "src\utils\ids.js",
  "src\utils\metrics.js",

  # src/grpc
  "src\grpc\server.js",
  "src\grpc\protoLoader.js",
  "src\grpc\interceptors\loggingInterceptor.js",
  "src\grpc\interceptors\clientInfoInterceptor.js",
  "src\grpc\interceptors\authInterceptor.js",
  "src\grpc\interceptors\errorMapper.js",
  "src\grpc\interceptors\chainInterceptors.js",
  "src\grpc\services\authService.js",
  "src\grpc\services\index.js",

  # src/domain/auth
  "src\domain\auth\authUseCases.js",
  "src\domain\auth\userRepository.js",
  "src\domain\auth\tokenService.js",
  "src\domain\auth\passwordService.js",
  "src\domain\auth\authErrors.js",

  # src/realtime
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

  # src/voice
  "src\voice\docs\voice-architecture.md",
  "src\voice\webrtc\stunTurnConfig.js",
  "src\voice\webrtc\sfuAdapter.js",

  # src/test
  "src\test\basic-test.js",
  "src\test\bench\presence-load.js",
  "src\test\bench\world-broadcast.js",
  "src\test\bench\npc-push.js",
  "src\test\bench\voice-signal.js"
)

$allowSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($p in $allowExact) { [void]$allowSet.Add($p) }

$extras = New-Object System.Collections.Generic.List[string]

# --- 1) Root level extras (files/folders) ---
Get-ChildItem -LiteralPath $root -Force | ForEach-Object {
  $name = $_.Name
  if (IsIgnoredRel $name) { return }

  if ($_.PSIsContainer) {
    if ($allowedRootDirs -notcontains $name) {
      $extras.Add($name) | Out-Null
    }
  } else {
    if ($allowedRootFiles -notcontains $name) {
      $extras.Add($name) | Out-Null
    }
  }
}

# --- 2) Inside allowed dirs: only FILE extras ---
$scanDirs = @("src","protos","envoy","certs","scripts")
foreach ($d in $scanDirs) {
  $fullDir = Join-Path $root $d
  if (!(Test-Path -LiteralPath $fullDir)) { continue }

  Get-ChildItem -LiteralPath $fullDir -Recurse -Force -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Path.Length).TrimStart('\')
    if (IsIgnoredRel $rel) { return }
    if (-not $allowSet.Contains($rel)) {
      $extras.Add($rel) | Out-Null
    }
  }
}

if ($extras.Count -eq 0) {
  Write-Host "NO_EXTRA_FILES ✅"
} else {
  Write-Host ("EXTRA_COUNT=" + $extras.Count)
  Write-Host ""
  Write-Host "Extra list:"
  foreach ($e in ($extras | Sort-Object)) {
    Write-Host (" - " + $e)
  }
}

Write-Host "============================================================"
Write-Host "SCRIPT_ENDED"
