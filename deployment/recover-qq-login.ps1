param([string]$ConfigPath=(Join-Path $PSScriptRoot '../private/live-config.json'))
$ErrorActionPreference='Stop'
$taskConfigPath=[IO.Path]::GetFullPath($ConfigPath)
$taskConfig=Get-Content -LiteralPath $taskConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskProfile=Get-Content -LiteralPath $taskConfig.profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskProfile.botId -notmatch '^\d{4,20}$'){throw 'INVALID_BOT_ID'}
$taskCredential=Join-Path (Join-Path (Split-Path -Parent $taskConfig.runtimeRoot) 'credentials') ('qq-'+$taskProfile.botId+'.dpapi')
if(-not(Test-Path -LiteralPath $taskCredential)){@{phase='credential-not-configured'}|ConvertTo-Json -Compress;exit 0}
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskMutex=[Threading.Mutex]::new($false,('Global\QQAssistantCoreLogin-'+$taskSid+'-'+$taskProfile.botId))
try{$taskLocked=$taskMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$taskLocked=$true}
if(-not $taskLocked){$taskMutex.Dispose();exit 0}
try{
 . (Join-Path $PSScriptRoot 'qq-credential.ps1')
 $taskMd5=Get-TaskQqPasswordMd5 -CredentialPath $taskCredential
 $taskNode=(Get-Command node.exe -ErrorAction Stop).Source
 $taskMd5 | & $taskNode (Join-Path $PSScriptRoot 'qq-login-recovery.mjs') --config $taskConfigPath
 $taskCode=$LASTEXITCODE
 exit $taskCode
}finally{$taskMd5=$null;if($taskLocked){$taskMutex.ReleaseMutex()};$taskMutex.Dispose()}
