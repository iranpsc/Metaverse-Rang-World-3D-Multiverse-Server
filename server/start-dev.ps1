# start-dev.ps1
# اجرا: powershell -ExecutionPolicy Bypass -File .\start-dev.ps1

$ErrorActionPreference = "Stop"

Write-Host "PWD = $PWD"

# 1) چک Docker
try {
    docker version | Out-Null
}
catch {
    Write-Host "Docker daemon is not available. Please open Docker Desktop first." -ForegroundColor Red
    exit 1
}

# 2) اگر Envoy container وجود دارد، start کن. اگر ندارد، خطا بده (چون ما حدس نمی‌زنیم بسازیم)
$exists = docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch "metaverse-envoy"
if (-not $exists) {
    Write-Host "Container 'metaverse-envoy' not found. Create it first with docker run." -ForegroundColor Red
    exit 1
}

# 3) اگر در حال اجرا نیست، start
$running = docker ps --format "{{.Names}}" | Select-String -SimpleMatch "metaverse-envoy"
if (-not $running) {
    Write-Host "Starting metaverse-envoy..."
    docker start metaverse-envoy | Out-Null
}
else {
    Write-Host "metaverse-envoy is already running."
}

# 4) اجرای سرور Node
Write-Host "Starting Node server: npm start"
npm start