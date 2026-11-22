param(
  [Parameter(Mandatory)] [string] $PdfFile,
  [Parameter(Mandatory)] [string] $ImageFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$extension = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1
}
function ReadResult($operation, [type] $resultType) {
  $method = $extension | Where-Object {
    $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
$inputFile = ReadResult ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($PdfFile))) ([Windows.Storage.StorageFile])
$pdf = ReadResult ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($inputFile)) ([Windows.Data.Pdf.PdfDocument])
if ($pdf.PageCount -lt 1) { throw 'The fixture print has no pages.' }
$page = $pdf.GetPage(0)
$memory = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
try {
  $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
  $options.DestinationWidth = 720
  $null = [Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $options.BitmapEncoderId = [Windows.Graphics.Imaging.BitmapEncoder]::PngEncoderId
  $method = $extension | Where-Object { !$_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  $task = $method.Invoke($null, @($page.RenderToStreamAsync($memory, $options)))
  $null = $task.GetAwaiter().GetResult()
  $memory.Seek(0)
  $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($memory)
  $outputFile = [IO.File]::Create($ImageFile)
  try { $reader.CopyTo($outputFile) } finally { $outputFile.Dispose(); $reader.Dispose() }
} finally { $memory.Dispose(); $page.Dispose() }
