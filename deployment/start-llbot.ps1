param([Parameter(Mandatory=$true)][string]$QqPath)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'json-process.ps1')
$taskManifest=Get-Content -LiteralPath (Join-Path $taskRoot 'private/llbot/deployment.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskManifest.version -ne 1 -or $taskManifest.account -notmatch '^\d{4,20} -or $taskManifest.bridge -ne 'llbot'){throw 'LLBOT_MANIFEST_INVALID'}
$taskVendor=[IO.Path]::GetFullPath((Join-Path $taskRoot 'private/llbot/vendor/v8.3.2'))
if([IO.Path]::GetFullPath($taskManifest.vendorRoot) -ne $taskVendor){throw 'LLBOT_VENDOR_SCOPE_INVALID'}
$taskAuthFile=Join-Path $taskVendor 'bin/llbot/data/auth_token.txt'
if(-not (Test-Path -LiteralPath $taskAuthFile) -or [string]::IsNullOrWhiteSpace([IO.File]::ReadAllText($taskAuthFile))){throw 'LLBOT_AUTH_TOKEN_REQUIRED: official authorization service must provide a valid token before startup'}
$taskSource=Get-Content -LiteralPath (Join-Path $taskRoot 'private/live-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskProfile=Get-Content -LiteralPath $taskSource.profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskProfile.botId -ne $taskManifest.account){throw 'LLBOT_ACCOUNT_MISMATCH'}
$taskNode=(Get-Command node.exe -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath $QqPath -PathType Leaf)){throw 'QQ_EXECUTABLE_REQUIRED'}
$taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskMutex=[Threading.Mutex]::new($false,('Global\QQAssistantCore-'+$taskIdentity+'-'+$taskManifest.account))
$taskLoginMutex=[Threading.Mutex]::new($false,('Global\QQAssistantCoreLogin-'+$taskIdentity+'-'+$taskManifest.account))
$taskLocked=$false;$taskLoginLocked=$false
try{
 try{$taskLocked=$taskMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLocked=$true}
 if(-not $taskLocked){throw 'LLBOT_SUPERVISOR_BUSY'}
 try{$taskLoginLocked=$taskLoginMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLoginLocked=$true}
 if(-not $taskLoginLocked){throw 'LLBOT_LOGIN_OPERATION_BUSY'}
 $taskExisting=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='LuckyLillia.exe'" | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskVendor,[StringComparison]::OrdinalIgnoreCase)})
 if($taskExisting.Count){throw 'LLBOT_ALREADY_RUNNING'}
 $taskBefore=Invoke-TaskJsonProcess -Executable $taskNode -Arguments @((Join-Path $PSScriptRoot 'runtime-health.mjs'))
 if($taskBefore.busy -or $taskBefore.qqOnline -or $taskBefore.loginPhase -eq 'qrcode_scanned' -or $taskBefore.loginRecoveryAction -eq 'complete-current-device-verification'){throw 'LLBOT_ACTIVE_SESSION_PRESERVED'}
 $taskConfig=Get-Content -LiteralPath (Join-Path $taskManifest.dataRoot ('config_'+$taskManifest.account+'.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
 if(@($taskConfig.ob11.connect | Where-Object {$_.type -eq 'http-post' -and $_.enable}).Count){throw 'LLBOT_EVENTS_MUST_BE_STAGED'}
 $taskSelection=@{version=1;bridge='llbot';account=$taskManifest.account;selectedAt=[DateTime]::UtcNow.ToString('o');autoStart=$false;reason='user-authorized-llbot-connection-attempt'}
 $taskTarget=Join-Path $taskRoot 'private/bridge-selection.json';$taskTemp=$taskTarget+'.pending'
 [IO.File]::WriteAllText($taskTemp,($taskSelection|ConvertTo-Json),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $taskTemp -Destination $taskTarget -Force
 # Only the owned NapCat node runtime is stopped. Standalone QQ is preserved.
 $taskNapExe=Join-Path $taskRoot 'napcat-node/node.exe'
 $taskNap=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq $taskNapExe})
 foreach($taskProcess in $taskNap){Stop-Process -Id $taskProcess.ProcessId -ErrorAction SilentlyContinue}
 # The release's bundled Node is older than the installed supported Node 24.
 $taskLlNode=Join-Path $taskVendor 'bin/llbot/node.exe';$taskOldNode=Join-Path $taskVendor 'bin/llbot/node-v24.13.0.original.exe'
 if(-not (Test-Path -LiteralPath $taskOldNode)){Copy-Item -LiteralPath $taskLlNode -Destination $taskOldNode}
 Copy-Item -LiteralPath $taskNode -Destination $taskLlNode -Force
 $taskStamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
 $taskOut=Join-Path $taskRoot ('private/llbot/launch-'+$taskStamp+'.stdout.log');$taskErr=Join-Path $taskRoot ('private/llbot/launch-'+$taskStamp+'.stderr.log')
 $taskArgs=@('--pmhq',('--qq='+$taskManifest.account),('--qq-path="'+$QqPath+'"'))
 $taskChild=Start-Process -FilePath (Join-Path $taskVendor 'LuckyLillia.exe') -ArgumentList $taskArgs -WorkingDirectory $taskVendor -WindowStyle Hidden -RedirectStandardOutput $taskOut -RedirectStandardError $taskErr -PassThru
 $taskAttempt=@{startedAt=[DateTime]::UtcNow.ToString('o');bridge='llbot';account=$taskManifest.account;mode='pmhq';launcherPid=$taskChild.Id;stdoutPath=$taskOut;stderrPath=$taskErr;eventsForwarded=$false;onlineVerified=$false}
 [IO.File]::WriteAllText((Join-Path $taskRoot 'private/llbot/attempt-state.json'),($taskAttempt|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 @{started=$true;bridge='llbot';mode='pmhq';account=$taskManifest.account;eventsForwarded=$false;onlineVerified=$false}|ConvertTo-Json -Compress
}finally{
 if($taskLoginLocked){$taskLoginMutex.ReleaseMutex()};$taskLoginMutex.Dispose()
 if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()
}
 -or $taskManifest.bridge -ne 'llbot'){throw 'LLBOT_MANIFEST_INVALID'}
$taskVendor=[IO.Path]::GetFullPath((Join-Path $taskRoot 'private/llbot/vendor/v8.3.2'))
if([IO.Path]::GetFullPath($taskManifest.vendorRoot) -ne $taskVendor){throw 'LLBOT_VENDOR_SCOPE_INVALID'}
$taskAuthFile=Join-Path $taskVendor 'bin/llbot/data/auth_token.txt'
if(-not (Test-Path -LiteralPath $taskAuthFile) -or [string]::IsNullOrWhiteSpace([IO.File]::ReadAllText($taskAuthFile))){throw 'LLBOT_AUTH_TOKEN_REQUIRED: official authorization service must provide a valid token before startup'}
$taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskMutex=[Threading.Mutex]::new($false,('Global\CodexQqSetTheory-'+$taskIdentity))
$taskLoginMutex=[Threading.Mutex]::new($false,('Global\CodexQqSetTheoryLogin-'+$taskIdentity))
$taskLocked=$false;$taskLoginLocked=$false
try{
 try{$taskLocked=$taskMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLocked=$true}
 if(-not $taskLocked){throw 'LLBOT_SUPERVISOR_BUSY'}
 try{$taskLoginLocked=$taskLoginMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLoginLocked=$true}
 if(-not $taskLoginLocked){throw 'LLBOT_LOGIN_OPERATION_BUSY'}
 $taskExisting=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='LuckyLillia.exe'" | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskVendor,[StringComparison]::OrdinalIgnoreCase)})
 if($taskExisting.Count){throw 'LLBOT_ALREADY_RUNNING'}
 $taskBefore=Invoke-TaskJsonProcess -Executable 'C:\Program Files\nodejs\node.exe' -Arguments @((Join-Path $PSScriptRoot 'runtime-health.mjs'))
 if($taskBefore.busy -or $taskBefore.qqOnline -or $taskBefore.loginPhase -eq 'qrcode_scanned' -or $taskBefore.loginRecoveryAction -eq 'complete-current-device-verification'){throw 'LLBOT_ACTIVE_SESSION_PRESERVED'}
 $taskConfig=Get-Content -LiteralPath (Join-Path $taskManifest.dataRoot 'config_2000000002.json') -Raw -Encoding UTF8 | ConvertFrom-Json
 if(@($taskConfig.ob11.connect | Where-Object {$_.type -eq 'http-post' -and $_.enable}).Count){throw 'LLBOT_EVENTS_MUST_BE_STAGED'}
 $taskSelection=@{version=1;bridge='llbot';account=$taskManifest.account;selectedAt=[DateTime]::UtcNow.ToString('o');autoStart=$false;reason='user-authorized-llbot-connection-attempt'}
 $taskTarget=Join-Path $taskRoot 'private/bridge-selection.json';$taskTemp=$taskTarget+'.pending'
 [IO.File]::WriteAllText($taskTemp,($taskSelection|ConvertTo-Json),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $taskTemp -Destination $taskTarget -Force
 # Only the owned NapCat node runtime is stopped. Standalone QQ is preserved.
 $taskNapExe=Join-Path $taskRoot 'napcat-node/node.exe'
 $taskNap=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq $taskNapExe})
 foreach($taskProcess in $taskNap){Stop-Process -Id $taskProcess.ProcessId -ErrorAction SilentlyContinue}
 # The release's bundled Node is older than the installed supported Node 24.
 $taskLlNode=Join-Path $taskVendor 'bin/llbot/node.exe';$taskOldNode=Join-Path $taskVendor 'bin/llbot/node-v24.13.0.original.exe'
 if(-not (Test-Path -LiteralPath $taskOldNode)){Copy-Item -LiteralPath $taskLlNode -Destination $taskOldNode}
 Copy-Item -LiteralPath 'C:\Program Files\nodejs\node.exe' -Destination $taskLlNode -Force
 $taskStamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
 $taskOut=Join-Path $taskRoot ('private/llbot/launch-'+$taskStamp+'.stdout.log');$taskErr=Join-Path $taskRoot ('private/llbot/launch-'+$taskStamp+'.stderr.log')
 $taskArgs=@('--pmhq','--qq=2000000002','--qq-path="C:\Program Files\Tencent\QQNT\QQ.exe"')
 $taskChild=Start-Process -FilePath (Join-Path $taskVendor 'LuckyLillia.exe') -ArgumentList $taskArgs -WorkingDirectory $taskVendor -WindowStyle Hidden -RedirectStandardOutput $taskOut -RedirectStandardError $taskErr -PassThru
 $taskAttempt=@{startedAt=[DateTime]::UtcNow.ToString('o');bridge='llbot';account=$taskManifest.account;mode='pmhq';launcherPid=$taskChild.Id;stdoutPath=$taskOut;stderrPath=$taskErr;eventsForwarded=$false;onlineVerified=$false}
 [IO.File]::WriteAllText((Join-Path $taskRoot 'private/llbot/attempt-state.json'),($taskAttempt|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 @{started=$true;bridge='llbot';mode='pmhq';account=$taskManifest.account;eventsForwarded=$false;onlineVerified=$false}|ConvertTo-Json -Compress
}finally{
 if($taskLoginLocked){$taskLoginMutex.ReleaseMutex()};$taskLoginMutex.Dispose()
 if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()
}
