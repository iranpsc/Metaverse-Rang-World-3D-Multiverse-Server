# move-extras-to-tools.ps1
# Ù‡Ø¯Ù: Ø§Ù†ØªÙ‚Ø§Ù„ ÙØ§ÛŒÙ„â€ŒÙ‡Ø§ÛŒ extra (Ø§Ø¨Ø²Ø§Ø±/Ú¯Ø²Ø§Ø±Ø´/Ø¨Ú©Ø§Ù¾) Ø§Ø² Ø±ÙˆØª Ø¨Ù‡ tools/
# Ù‚Ø§Ù†ÙˆÙ†: Ø­Ø°Ù Ù†Ù…ÛŒâ€ŒÚ©Ù†Ø¯ØŒ ÙÙ‚Ø· Move Ù…ÛŒâ€ŒÚ©Ù†Ø¯ (Ø§Ú¯Ø± Ù…Ù‚ØµØ¯ ÙˆØ¬ÙˆØ¯ Ø¯Ø§Ø´ØªÙ‡ Ø¨Ø§Ø´Ø¯ overwrite Ù†Ù…ÛŒâ€ŒÚ©Ù†Ø¯)

Write-Host "SCRIPT_STARTED"
$root = Get-Location
Write-Host ("PWD=" + $root)
Write-Host "============================================================"

$toolsDir = Join-Path $root "tools"
if (!(Test-Path -LiteralPath $toolsDir)) {
  New-Item -ItemType Directory -Path $toolsDir | Out-Null
  Write-Host ("MKDIR : tools\")
}

$extras = @(
  "BACKUP_before_cleanup_20260225_032858.zip",
  "PROJECT_TREE_CLEAN.txt",
  "check-against-target.ps1",
  "check-extra-files.ps1",
  "compare-structure.ps1",
  "create-missing-skeleton.ps1",
  "dump-project-tree-clean.ps1",
  "restore-missing-safe.ps1"
)

foreach ($rel in $extras) {
  $src = Join-Path $root $rel
  $dst = Join-Path $toolsDir $rel

  if (!(Test-Path -LiteralPath $src)) {
    Write-Host ("SKIP : " + $rel + " (not found)")
    continue
  }

  if (Test-Path -LiteralPath $dst) {
    Write-Host ("SKIP : tools\" + $rel + " (already exists)")
    continue
  }

  Move-Item -LiteralPath $src -Destination $dst
  Write-Host ("MOVE : " + $rel + " -> tools\" + $rel)
}

Write-Host "============================================================"
Write-Host "SCRIPT_ENDED"
