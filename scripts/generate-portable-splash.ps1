param(
  [string]$OutputPath = "desktop/build/portable-splash.bmp"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$bitmap = [System.Drawing.Bitmap]::new(520, 300)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$resources = [System.Collections.Generic.List[System.IDisposable]]::new()

try {
  # Graphite base + restrained color fields give the dark splash depth without
  # turning it into a bright illustration. The hierarchy follows the same
  # page/panel/surface model used by Primer, Radix, and Geist.
  $backgroundBounds = [System.Drawing.Rectangle]::new(0, 0, 520, 300)
  $backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $backgroundBounds,
    [System.Drawing.ColorTranslator]::FromHtml("#080A0F"),
    [System.Drawing.ColorTranslator]::FromHtml("#101522"),
    24
  )
  $resources.Add($backgroundBrush)
  $graphics.FillRectangle($backgroundBrush, $backgroundBounds)

  foreach ($glow in @(
    @{ X = -100; Y = -92; Width = 360; Height = 260; Color = [System.Drawing.Color]::FromArgb(25, 123, 92, 255) },
    @{ X = 330; Y = 138; Width = 300; Height = 230; Color = [System.Drawing.Color]::FromArgb(20, 52, 196, 255) },
    @{ X = 86; Y = 220; Width = 330; Height = 130; Color = [System.Drawing.Color]::FromArgb(12, 45, 212, 191) }
  )) {
    $glowBrush = [System.Drawing.SolidBrush]::new($glow.Color)
    $resources.Add($glowBrush)
    $graphics.FillEllipse($glowBrush, $glow.X, $glow.Y, $glow.Width, $glow.Height)
  }

  $gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(10, 191, 207, 255), 1)
  $resources.Add($gridPen)
  for ($x = 0; $x -le 520; $x += 26) { $graphics.DrawLine($gridPen, $x, 0, $x, 300) }
  for ($y = 0; $y -le 300; $y += 26) { $graphics.DrawLine($gridPen, 0, $y, 520, $y) }

  $shadowPath = New-RoundedRectanglePath -X 29 -Y 27 -Width 462 -Height 252 -Radius 24
  $resources.Add($shadowPath)
  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(72, 0, 0, 0))
  $resources.Add($shadowBrush)
  $graphics.FillPath($shadowBrush, $shadowPath)

  $panelPath = New-RoundedRectanglePath -X 26 -Y 23 -Width 468 -Height 252 -Radius 24
  $resources.Add($panelPath)
  $panelBounds = [System.Drawing.Rectangle]::new(26, 23, 468, 252)
  $panelBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $panelBounds,
    [System.Drawing.ColorTranslator]::FromHtml("#171C29"),
    [System.Drawing.ColorTranslator]::FromHtml("#0D111A"),
    90
  )
  $resources.Add($panelBrush)
  $graphics.FillPath($panelBrush, $panelPath)
  $panelBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 154, 168, 210), 1)
  $resources.Add($panelBorder)
  $graphics.DrawPath($panelBorder, $panelPath)

  $topHighlight = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(50, 255, 255, 255), 1)
  $resources.Add($topHighlight)
  $graphics.DrawLine($topHighlight, 54, 24, 466, 24)

  $markShadowPath = New-RoundedRectanglePath -X 54 -Y 53 -Width 72 -Height 72 -Radius 22
  $resources.Add($markShadowPath)
  $markShadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(86, 67, 48, 166))
  $resources.Add($markShadowBrush)
  $graphics.FillPath($markShadowBrush, $markShadowPath)

  $markPath = New-RoundedRectanglePath -X 54 -Y 49 -Width 72 -Height 72 -Radius 22
  $resources.Add($markPath)
  $markBounds = [System.Drawing.Rectangle]::new(54, 49, 72, 72)
  $markBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $markBounds,
    [System.Drawing.ColorTranslator]::FromHtml("#806BFF"),
    [System.Drawing.ColorTranslator]::FromHtml("#376EEB"),
    42
  )
  $resources.Add($markBrush)
  $graphics.FillPath($markBrush, $markPath)
  $markBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(108, 255, 255, 255), 1)
  $resources.Add($markBorder)
  $graphics.DrawPath($markBorder, $markPath)

  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#F7F8FC"))
  $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#ECEFF7"))
  $mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#929AAF"))
  $dimBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#687086"))
  $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#7695FF"))
  $trackBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#242A38"))
  foreach ($brush in @($whiteBrush, $textBrush, $mutedBrush, $dimBrush, $accentBrush, $trackBrush)) { $resources.Add($brush) }

  $markFont = [System.Drawing.Font]::new("Georgia", 45, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brandFont = [System.Drawing.Font]::new("Segoe UI", 27, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $kickerFont = [System.Drawing.Font]::new("Segoe UI", 10, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new("Segoe UI", 13, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $metaFont = [System.Drawing.Font]::new("Segoe UI", 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  foreach ($font in @($markFont, $brandFont, $kickerFont, $bodyFont, $metaFont)) { $resources.Add($font) }

  $centered = [System.Drawing.StringFormat]::new()
  $centered.Alignment = [System.Drawing.StringAlignment]::Center
  $centered.LineAlignment = [System.Drawing.StringAlignment]::Center
  $resources.Add($centered)
  $graphics.DrawString([char]0x03C0, $markFont, $whiteBrush, [System.Drawing.RectangleF]::new(54, 43, 72, 72), $centered)

  $graphics.DrawString("PIORA", $kickerFont, $accentBrush, 151, 50)
  $graphics.DrawString("Your AI workspace", $brandFont, $textBrush, 148, 68)
  $graphics.DrawString("Preparing local models, sessions and projects", $bodyFont, $mutedBrush, 151, 106)

  $trackPath = New-RoundedRectanglePath -X 54 -Y 178 -Width 412 -Height 5 -Radius 2.5
  $resources.Add($trackPath)
  $graphics.FillPath($trackBrush, $trackPath)
  $progressPath = New-RoundedRectanglePath -X 54 -Y 178 -Width 142 -Height 5 -Radius 2.5
  $resources.Add($progressPath)
  $progressBounds = [System.Drawing.Rectangle]::new(54, 178, 142, 5)
  $progressBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $progressBounds,
    [System.Drawing.ColorTranslator]::FromHtml("#765BFF"),
    [System.Drawing.ColorTranslator]::FromHtml("#4BC8F5"),
    0
  )
  $resources.Add($progressBrush)
  $graphics.FillPath($progressBrush, $progressPath)

  $statusDot = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#67D9F3"))
  $resources.Add($statusDot)
  $graphics.FillEllipse($statusDot, 55, 211, 6, 6)
  $graphics.DrawString("STARTING PIORA", $metaFont, $mutedBrush, 69, 205)
  $graphics.DrawString("LOCAL-FIRST", $metaFont, $dimBrush, 386, 205)

  $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  for ($index = $resources.Count - 1; $index -ge 0; $index -= 1) {
    $resources[$index].Dispose()
  }
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output $resolvedOutput
