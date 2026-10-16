param([string]$ConfigPath=(Join-Path $PSScriptRoot '../private/live-config.json'))
$ErrorActionPreference='Stop'
$taskConfigPath=[IO.Path]::GetFullPath($ConfigPath)
$taskConfig=Get-Content -LiteralPath $taskConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskProfile=Get-Content -LiteralPath $taskConfig.profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskProfile.botId -notmatch '^\d{4,20}$'){throw 'INVALID_BOT_ID'}
$taskName='QQ-Assistant-Core-'+$taskProfile.botId
$taskUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -File "'+(Join-Path $PSScriptRoot 'supervise-runtime.ps1')+'" -ConfigPath "'+$taskConfigPath+'" -Once') -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$taskPrincipal=New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$taskTriggers=@((New-ScheduledTaskTrigger -AtLogOn -User $taskUser),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$taskSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTriggers -Principal $taskPrincipal -Settings $taskSettings -Description 'Maintain the configured assistant on AC power in the logged-in Windows user session; respect verification pauses and login backoff.' -Force | Out-Null
@{installed=$true;task=$taskName;intervalSeconds=60;userSessionOnly=$true}|ConvertTo-Json -Compress
