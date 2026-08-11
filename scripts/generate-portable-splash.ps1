param(
  [string]$OutputPath = "desktop/build/portable-splash.bmp"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 520, 300
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

try {
  $background = [System.Drawing.ColorTranslator]::FromHtml("#111214")
  $panel = [System.Drawing.ColorTranslator]::FromHtml("#1A1B1E")
  $text = [System.Drawing.ColorTranslator]::FromHtml("#F5F5F5")
  $muted = [System.Drawing.ColorTranslator]::FromHtml("#A7A7AA")
  $accent = [System.Drawing.ColorTranslator]::FromHtml("#7C6DF2")
  $track = [System.Drawing.ColorTranslator]::FromHtml("#303136")

  $graphics.Clear($background)
  $panelBrush = [System.Drawing.SolidBrush]::new($panel)
  $accentBrush = [System.Drawing.SolidBrush]::new($accent)
  $textBrush = [System.Drawing.SolidBrush]::new($text)
  $mutedBrush = [System.Drawing.SolidBrush]::new($muted)
  $trackBrush = [System.Drawing.SolidBrush]::new($track)
  $titleFont = [System.Drawing.Font]::new("Segoe UI", 28, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new("Segoe UI", 14, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

  $graphics.FillRectangle($panelBrush, 24, 24, 472, 252)
  $graphics.FillEllipse($accentBrush, 54, 67, 58, 58)
  $graphics.FillEllipse($panelBrush, 69, 82, 28, 28)
  $graphics.DrawString("Piora", $titleFont, $textBrush, 136, 65)
  $graphics.DrawString("Starting your workspace...", $bodyFont, $mutedBrush, 138, 108)

  $graphics.FillRectangle($trackBrush, 55, 196, 410, 4)
  $graphics.FillRectangle($accentBrush, 55, 196, 132, 4)
  $graphics.DrawString("Loading local resources securely", $bodyFont, $mutedBrush, 55, 216)

  $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  foreach ($resource in @($trackBrush, $bodyFont, $titleFont, $mutedBrush, $textBrush, $accentBrush, $panelBrush, $graphics, $bitmap)) {
    if ($null -ne $resource) { $resource.Dispose() }
  }
}

Write-Output $resolvedOutput
