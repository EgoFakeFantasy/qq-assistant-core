param([switch]$Once,[string]$ConfigPath=(Join-Path $PSScriptRoot '../private/live-config.json'))
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskConfigPath=[IO.Path]::GetFullPath($ConfigPath)
$taskConfig=Get-Content -LiteralPath $taskConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskProfile=Get-Content -LiteralPath $taskConfig.profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskProfile.botId -notmatch '^\d{4,20}$'){throw 'INVALID_BOT_ID'}
$taskNode=(Get-Command node.exe -ErrorAction Stop).Source
$taskMonitor=Join-Path (Split-Path -Parent $taskConfig.runtimeRoot) 'supervision'
New-Item -ItemType Directory -Force -Path $taskMonitor | Out-Null
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskMutex=[Threading.Mutex]::new($false,('Global\QQAssistantCore-'+$taskSid+'-'+$taskProfile.botId))
try{$taskLocked=$taskMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLocked=$true}
if(-not $taskLocked){$taskMutex.Dispose();exit 0}
function Get-TaskProcesses([string]$Entry){
 if(-not $Entry){return @()}
 @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -match [regex]::Escape($Entry)})
}
function Start-TaskNode([string]$Kind,[string]$Executable,[string]$Entry,[string[]]$Extra){
 if(-not(Test-Path -LiteralPath $Entry)){return}
 $taskStamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
 $taskArguments=@(('"'+$Entry+'"'))+$Extra
 $taskWork=if($Kind -eq 'qq'){Split-Path -Parent $Entry}else{$taskRoot}
 Start-Process -FilePath $Executable -ArgumentList $taskArguments -WorkingDirectory $taskWork -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskMonitor ($Kind+'-'+$taskStamp+'.stdout.log')) -RedirectStandardError (Join-Path $taskMonitor ($Kind+'-'+$taskStamp+'.stderr.log')) | Out-Null
}
try{
 do{
  try{
   $taskBatteries=@(Get-CimInstance -Namespace root/WMI -ClassName BatteryStatus -ErrorAction SilentlyContinue | Where-Object {$_.Active})
   $taskPower=if($taskBatteries.Count){[bool]($taskBatteries | Where-Object {$_.PowerOnline})}else{$true}
   $taskHub=Join-Path $taskRoot 'profiles/set-theory/start-live.mjs'
   if($taskPower -and [Environment]::UserInteractive){
    if($taskConfig.napcatEntryPath -and $taskConfig.napcatNodePath -and @(Get-TaskProcesses $taskConfig.napcatEntryPath).Count -eq 0){
     Start-TaskNode 'qq' $taskConfig.napcatNodePath $taskConfig.napcatEntryPath @('-q',$taskProfile.botId)
    }
    if(@(Get-TaskProcesses $taskHub).Count -eq 0){
     $taskLock=[IO.Path]::GetFullPath((Join-Path $taskConfig.runtimeRoot 'hub.lock'))
     if((Split-Path -Parent $taskLock) -ne [IO.Path]::GetFullPath($taskConfig.runtimeRoot)){throw 'LOCK_PATH_OUTSIDE_RUNTIME'}
     if(Test-Path -LiteralPath $taskLock){
      $taskOwner=0;[void][int]::TryParse((Get-Content -LiteralPath $taskLock -Raw).Trim(),[ref]$taskOwner)
      if($taskOwner -le 0 -or (Get-Process -Id $taskOwner -ErrorAction SilentlyContinue)){throw 'LOCK_REQUIRES_OPERATOR_REVIEW'}
      Remove-Item -LiteralPath $taskLock
     }
     Start-TaskNode 'hub' $taskNode $taskHub @('--live','--config',('"'+$taskConfigPath+'"'))
    }
   }
   $taskPanel=Join-Path $taskRoot 'profiles/set-theory/start-account-panel.mjs'
   if($taskPower -and [Environment]::UserInteractive -and $taskConfig.bilibiliUid -and @(Get-TaskProcesses $taskPanel).Count -eq 0){Start-TaskNode 'accounts' $taskNode $taskPanel @('--config',('"'+$taskConfigPath+'"'))}
   $taskHealth=(& $taskNode (Join-Path $PSScriptRoot 'runtime-health.mjs') --config $taskConfigPath 2>$null | Out-String).Trim() | ConvertFrom-Json
   $taskLogin=$null
   if($taskPower -and [Environment]::UserInteractive -and $taskHealth.webuiReachable -and -not $taskHealth.qqOnline){
    $taskRaw=(& powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'recover-qq-login.ps1') -ConfigPath $taskConfigPath 2>$null | Out-String).Trim()
    if($taskRaw){$taskLogin=$taskRaw|ConvertFrom-Json}
   }
   $taskState=@{time=[DateTime]::UtcNow.ToString('o');powerOnline=$taskPower;health=$taskHealth;loginRecovery=$taskLogin}
   $taskFile=Join-Path $taskMonitor 'status.json'
   [IO.File]::WriteAllText(($taskFile+'.pending'),($taskState|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
   Move-Item -LiteralPath ($taskFile+'.pending') -Destination $taskFile -Force
  }catch{
   [IO.File]::WriteAllText((Join-Path $taskMonitor 'last-error.json'),(@{time=[DateTime]::UtcNow.ToString('o');reason='SUPERVISION_CHECK_FAILED'}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  }
  if(-not $Once){Start-Sleep -Seconds 30}
 }while(-not $Once)
}finally{if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
