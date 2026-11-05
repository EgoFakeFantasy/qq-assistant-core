function Get-TaskProcessLockPid {
 param([Parameter(Mandatory=$true)][string]$Path)
 $taskLockValue=Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
 $taskLockCandidate=if($taskLockValue -is [ValueType]){$taskLockValue}else{$taskLockValue.pid}
 $taskLockNumber=0
 if(-not [int]::TryParse([string]$taskLockCandidate,[ref]$taskLockNumber) -or $taskLockNumber -lt 1){throw 'INVALID_PROCESS_LOCK'}
 return $taskLockNumber
}
