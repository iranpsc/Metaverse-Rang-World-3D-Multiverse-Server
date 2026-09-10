# dump-project-tree-clean.ps1
# Ù‡Ø¯Ù: Ø®Ø±ÙˆØ¬ÛŒ Ø¯Ø±Ø®Øª Ù¾Ø±ÙˆÚ˜Ù‡ Ø¨Ø±Ø§ÛŒ Ø¨Ø±Ø±Ø³ÛŒØŒ Ø¨Ø¯ÙˆÙ† node_modules Ùˆ __restore_tmp_*
# Ø®Ø±ÙˆØ¬ÛŒ: PROJECT_TREE_CLEAN.txt

$root = Get-Location
$outFile = Join-Path $root "PROJECT_TREE_CLEAN.txt"

function IsIgnoredRel([string]$rel) {
  if ($rel -eq "node_modules" -or $rel -like "node_modules\*") { return $true }
  if ($rel -like "__restore_tmp_*" -or $rel -like "__restore_tmp_*\*") { return $true }
  return $false
}

Write-Host "SCRIPT_STARTED"
Write-Host ("PWD=" + $root)
Write-Host ("OUT=" + $outFile)
Write-Host "============================================================"

# Ø¬Ù…Ø¹â€ŒØ¢ÙˆØ±ÛŒ ØªÙ…Ø§Ù… Ù…Ø³ÛŒØ±Ù‡Ø§ (ÙØ§ÛŒÙ„ + ÙÙˆÙ„Ø¯Ø±) Ø¨Ù‡ ØµÙˆØ±Øª relative
$items = Get-ChildItem -LiteralPath $root -Recurse -Force |
  ForEach-Object {
    $rel = $_.FullName.Substring($root.Path.Length).TrimStart('\')
    if ($rel -and -not (IsIgnoredRel $rel)) { $rel }
  } |
  Sort-Object

# Ù†ÙˆØ´ØªÙ† ÙØ§ÛŒÙ„ Ø®Ø±ÙˆØ¬ÛŒ
"Root: $root" | Set-Content -Encoding UTF8 $outFile
"============================================================" | Add-Content -Encoding UTF8 $outFile

foreach ($rel in $items) {
  $full = Join-Path $root $rel
  if (Test-Path -LiteralPath $full -PathType Container) {
    Add-Content -Encoding UTF8 $outFile ("[DIR ] " + $rel)
  } else {
    $len = (Get-Item -LiteralPath $full).Length
    Add-Content -Encoding UTF8 $outFile ("[FILE] " + $rel + " (" + $len + " bytes)")
  }
}

"============================================================" | Add-Content -Encoding UTF8 $outFile
Add-Content -Encoding UTF8 $outFile ("Total items: " + $items.Count)

Write-Host ("WROTE: " + $outFile)
Write-Host "SCRIPT_ENDED"
