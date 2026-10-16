param([Security.SecureString]$Secret,[string]$ConfigPath=(Join-Path $PSScriptRoot '../private/live-config.json'))
$ErrorActionPreference='Stop'
$taskConfig=Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskProfile=Get-Content -LiteralPath $taskConfig.profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskProfile.botId -notmatch '^\d{4,20}$'){throw 'INVALID_BOT_ID'}
$taskDir=Join-Path (Split-Path -Parent $taskConfig.runtimeRoot) 'credentials'
$taskFile=Join-Path $taskDir ('qq-'+$taskProfile.botId+'.dpapi')
if(-not $Secret){$Secret=Read-Host 'QQ password (encrypted for this Windows user)' -AsSecureString}
if($Secret.Length -eq 0){throw 'EMPTY_CREDENTIAL'}
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$taskSystem=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$taskAcl=Get-Acl -LiteralPath $taskDir
$taskAcl.SetAccessRuleProtection($true,$false)
foreach($taskPrincipal in @($taskSid,$taskSystem)){
 $taskRule=[Security.AccessControl.FileSystemAccessRule]::new($taskPrincipal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $taskAcl.SetAccessRule($taskRule)
}
Set-Acl -LiteralPath $taskDir -AclObject $taskAcl
try{[IO.File]::WriteAllText($taskFile,(ConvertFrom-SecureString -SecureString $Secret),[Text.UTF8Encoding]::new($false))}
finally{$Secret.Dispose()}
@{stored=$true;encryption='Windows DPAPI CurrentUser';plaintextFile=$false}|ConvertTo-Json -Compress
