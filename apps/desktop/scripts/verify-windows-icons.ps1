param(
  [Parameter(Mandatory = $true)][string]$Unpacked,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Source
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-NormalizedPixels([System.Drawing.Bitmap]$Bitmap) {
  $normalized = New-Object System.Drawing.Bitmap 64, 64
  $graphics = [System.Drawing.Graphics]::FromImage($normalized)
  try { $graphics.DrawImage($Bitmap, 0, 0, 64, 64) } finally { $graphics.Dispose(); $Bitmap.Dispose() }
  $bytes = New-Object System.Collections.Generic.List[byte]
  for ($y = 0; $y -lt 64; $y++) {
    for ($x = 0; $x -lt 64; $x++) {
      $pixel = $normalized.GetPixel($x, $y)
      $bytes.Add($pixel.A); $bytes.Add($pixel.R); $bytes.Add($pixel.G); $bytes.Add($pixel.B)
    }
  }
  $normalized.Dispose()
  return $bytes.ToArray()
}

function Get-SourceBitmap([string]$Path) {
  $resolved = (Resolve-Path $Path).Path
  if ([System.IO.Path]::GetExtension($resolved).Equals('.ico', [System.StringComparison]::OrdinalIgnoreCase)) {
    $icon = [System.Drawing.Icon]::new($resolved)
    try { return $icon.ToBitmap() } finally { $icon.Dispose() }
  }
  return [System.Drawing.Bitmap]::FromFile($resolved)
}

function Get-MeanDifference([byte[]]$Left, [byte[]]$Right) {
  if ($Left.Length -ne $Right.Length) { throw 'normalized icon lengths differ' }
  [long]$sum = 0
  for ($index = 0; $index -lt $Left.Length; $index++) {
    $sum += [Math]::Abs([int]$Left[$index] - [int]$Right[$index])
  }
  return $sum / $Left.Length
}

$sourcePixels = Get-NormalizedPixels (Get-SourceBitmap $Source)
foreach ($file in @((Join-Path $Unpacked 'DeepSeek Harness.exe'), $Installer)) {
  $resolved = (Resolve-Path $file).Path
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($resolved)
  if ($null -eq $icon) { throw "missing associated icon: $resolved" }
  $difference = Get-MeanDifference $sourcePixels (Get-NormalizedPixels $icon.ToBitmap())
  $icon.Dispose()
  if ($difference -gt 12) { throw "associated icon differs from approved mark: $resolved ($difference)" }
  Write-Host "verify-windows-icons: $resolved mean difference $difference"
}
