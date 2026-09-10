# scripts/mkcert-dev.ps1
# Run from server/ folder:
# powershell -ExecutionPolicy Bypass -File .\scripts\mkcert-dev.ps1

$ErrorActionPreference = "Stop"

Write-Host "Installing mkcert local CA (Trust)..." -ForegroundColor Cyan
mkcert -install

if (!(Test-Path ".\certs")) { New-Item -ItemType Directory -Path ".\certs" | Out-Null }

Write-Host "Generating localhost cert..." -ForegroundColor Cyan
mkcert -cert-file .\certs\localhost.pem -key-file .\certs\localhost-key.pem localhost 127.0.0.1 ::1

Write-Host "Done. Files:" -ForegroundColor Green
Get-ChildItem .\certs