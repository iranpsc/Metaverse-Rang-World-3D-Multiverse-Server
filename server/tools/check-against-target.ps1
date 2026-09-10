# check-against-target.ps1
# هدف: چک کردن دقیق ساختار مرجع server/ بدون اسکن درخت و بدون نمایش node_modules

try {
  Write-Host "SCRIPT_STARTED"
  $root = Get-Location
  Write-Host ("PWD=" + $root)
  Write-Host "============================================================"

  # فقط مسیرهای مرجع (source of truth) — هیچ چیز دیگری چک نمی‌شود
  $required = @(
    # protos
    "protos\common\common.proto",
    "protos\common\user.proto",
    "protos\auth\auth.proto",
    "protos\realtime\realtime.proto",
    "protos\health.proto",

    # src core
    "src\index.js",
    "src\shutdown.js",

    # config
    "src\config\env.js",
    "src\config\tls.js",
    "src\config\validation.js",

    # utils
    "src\utils\logger.js",
    "src\utils\ids.js",
    "src\utils\metrics.js",

    # grpc
    "src\grpc\server.js",
    "src\grpc\protoLoader.js",
    "src\grpc\interceptors\loggingInterceptor.js",
    "src\grpc\interceptors\clientInfoInterceptor.js",
    "src\grpc\interceptors\authInterceptor.js",
    "src\grpc\interceptors\errorMapper.js",
    "src\grpc\interceptors\chainInterceptors.js",
    "src\grpc\services\authService.js",
    "src\grpc\services\index.js",

    # domain/auth
    "src\domain\auth\authUseCases.js",
    "src\domain\auth\userRepository.js",
    "src\domain\auth\tokenService.js",
    "src\domain\auth\passwordService.js",
    "src\domain\auth\authErrors.js",

    # realtime
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

    # voice
    "src\voice\docs\voice-architecture.md",
    "src\voice\webrtc\stunTurnConfig.js",
    "src\voice\webrtc\sfuAdapter.js",

    # test
    "src\test\basic-test.js",
    "src\test\bench\presence-load.js",
    "src\test\bench\world-broadcast.js",
    "src\test\bench\npc-push.js",
    "src\test\bench\voice-signal.js",

    # envoy (اختیاری ولی در ساختار مرجع هست)
    "envoy\envoy.yaml",

    # certs (در روت — طبق تصمیم جدید)
    "certs\localhost.pem",
    "certs\localhost-key.pem",

    # scripts
    "scripts\mkcert-dev.ps1",
    "scripts\create-realtime-skeleton.ps1",

    # root docs
    ".env.example",
    "package.json",
    "README.md"
  )

  $presentList = New-Object System.Collections.Generic.List[string]
  $missingList = New-Object System.Collections.Generic.List[string]

  foreach ($rel in $required) {
    $full = Join-Path $root $rel
    if (Test-Path $full) {
      $presentList.Add($rel) | Out-Null
      Write-Host ("OK   : " + $rel)
    } else {
      $missingList.Add($rel) | Out-Null
      Write-Host ("MISS : " + $rel)
    }
  }

  Write-Host "============================================================"
  Write-Host ("Present: " + $presentList.Count)
  Write-Host ("Missing: " + $missingList.Count)

  if ($missingList.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing list:"
    foreach ($m in $missingList) { Write-Host (" - " + $m) }
  }

  Write-Host "SCRIPT_ENDED"
}
catch {
  Write-Host "SCRIPT_ERROR"
  Write-Host $_
}
