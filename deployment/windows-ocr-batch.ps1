param([Parameter(Mandatory=$true)][string]$Manifest)
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
$taskEngine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
if($null -eq $taskEngine){throw 'CHINESE_OCR_UNAVAILABLE'}
$taskBatch=Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$taskRoot=[IO.Path]::GetFullPath($taskBatch.root)
$taskImageRoot=[IO.Path]::GetFullPath((Join-Path $taskRoot 'images'))+[IO.Path]::DirectorySeparatorChar
$taskOutputRoot=[IO.Path]::GetFullPath((Join-Path $taskRoot 'results'))+[IO.Path]::DirectorySeparatorChar
$taskTotal=$taskBatch.jobs.Count;$taskDone=0;$taskErrors=0
$taskTimer=[Diagnostics.Stopwatch]::StartNew()
foreach($taskJob in $taskBatch.jobs){
  $taskImage=[IO.Path]::GetFullPath($taskJob.image);$taskOutput=[IO.Path]::GetFullPath($taskJob.output)
  if(-not $taskImage.StartsWith($taskImageRoot,[StringComparison]::OrdinalIgnoreCase) -or -not $taskOutput.StartsWith($taskOutputRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'OCR_PATH_OUTSIDE_STAGE'}
  if(-not (Test-Path -LiteralPath $taskOutput)){
    $taskWait=[Diagnostics.Stopwatch]::StartNew()
    while(-not (Test-Path -LiteralPath $taskImage)){
      if($taskWait.Elapsed.TotalSeconds -gt 300){throw 'OCR_RENDER_STALLED'}
      [Threading.Thread]::Sleep(150)
    }
    $taskStream=$null;$taskBitmap=$null
    try{
      $taskFile=Wait-WinRtTask ([Windows.Storage.StorageFile]::GetFileFromPathAsync($taskImage)) ([Windows.Storage.StorageFile])
      $taskStream=Wait-WinRtTask ($taskFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $taskDecoder=Wait-WinRtTask ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($taskStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $taskBitmap=Wait-WinRtTask ($taskDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $taskResult=Wait-WinRtTask ($taskEngine.RecognizeAsync($taskBitmap)) ([Windows.Media.Ocr.OcrResult])
      $taskData=@{bookId=$taskJob.bookId;page=$taskJob.page;text=$taskResult.Text;lines=@($taskResult.Lines | ForEach-Object {$_.Text});engine='Windows.Media.Ocr/zh-Hans-CN';formulaAccuracyVerified=$false}
    }catch{$taskErrors++;$taskData=@{error='OCR_PAGE_FAILURE';bookId=$taskJob.bookId;page=$taskJob.page}}
    finally{if($taskBitmap){$taskBitmap.Dispose()};if($taskStream){$taskStream.Dispose()}}
    $taskTemp=$taskOutput+'.tmp'
    [IO.File]::WriteAllText($taskTemp,($taskData | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $taskTemp -Destination $taskOutput
    Remove-Item -LiteralPath $taskImage
  }
  $taskDone++
  if($taskDone%25 -eq 0 -or $taskDone -eq $taskTotal){
    $taskProgress=@{processed=$taskDone;total=$taskTotal;errors=$taskErrors;seconds=$taskTimer.Elapsed.TotalSeconds;completed=($taskDone -eq $taskTotal)}
    [IO.File]::WriteAllText((Join-Path $taskRoot 'progress.json'),($taskProgress | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Output ($taskProgress | ConvertTo-Json -Compress)
  }
}