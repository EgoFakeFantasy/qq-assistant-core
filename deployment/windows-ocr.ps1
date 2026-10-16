param([Parameter(Mandatory=$true)][string]$Image,[Parameter(Mandatory=$true)][string]$Output,[ValidateSet('zh-Hans-CN','en-US')][string]$Language='zh-Hans-CN')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$taskAsTaskMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
function Wait-WinRtTask($Operation,[Type]$ResultType){
  $taskAwait=$taskAsTaskMethod.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
  $taskAwait.GetAwaiter().GetResult()
}
$taskTimer=[Diagnostics.Stopwatch]::StartNew()
$taskLanguage=[Windows.Globalization.Language]::new($Language)
$taskEngine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($taskLanguage)
if($null -eq $taskEngine){throw 'OCR_LANGUAGE_UNAVAILABLE'}
$taskFile=Wait-WinRtTask ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($Image))) ([Windows.Storage.StorageFile])
$taskStream=Wait-WinRtTask ($taskFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try{
  $taskDecoder=Wait-WinRtTask ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($taskStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $taskBitmap=Wait-WinRtTask ($taskDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try{$taskResult=Wait-WinRtTask ($taskEngine.RecognizeAsync($taskBitmap)) ([Windows.Media.Ocr.OcrResult])}finally{$taskBitmap.Dispose()}
  $taskData=@{text=$taskResult.Text;lines=@($taskResult.Lines | ForEach-Object {$_.Text});engine=('Windows.Media.Ocr/'+$Language);formulaAccuracyVerified=$false;seconds=$taskTimer.Elapsed.TotalSeconds}
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),($taskData | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  Write-Output ('OCR characters='+$taskResult.Text.Length+' seconds='+[Math]::Round($taskTimer.Elapsed.TotalSeconds,2))
}finally{$taskStream.Dispose()}