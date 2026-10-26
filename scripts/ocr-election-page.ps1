param([Parameter(Mandatory=$true)][string]$ImagePath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
function Await-Operation($Operation,[Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
  $task.GetAwaiter().GetResult()
}
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $ImagePath).Path)) ([Windows.Storage.StorageFile])
$stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { throw 'Windows OCR language unavailable' }
  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $payload = @{engine='Windows.Media.Ocr';language=$engine.RecognizerLanguage.LanguageTag;image=(Split-Path $ImagePath -Leaf);lines=@($result.Lines | ForEach-Object {$_.Text})}
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath),($payload | ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
} finally {$stream.Dispose()}
