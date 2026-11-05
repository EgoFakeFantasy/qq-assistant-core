function Get-TaskSelectedBridge {
 param([Parameter(Mandatory=$true)][string]$ProjectRoot)
 $taskSelectionPath=Join-Path $ProjectRoot 'private/bridge-selection.json'
 if(-not (Test-Path -LiteralPath $taskSelectionPath)){return 'napcat'}
 $taskSelection=Get-Content -LiteralPath $taskSelectionPath -Raw -Encoding UTF8 | ConvertFrom-Json
 if($taskSelection.version -ne 1 -or $taskSelection.account -notmatch '^\d{4,20}$' -or $taskSelection.bridge -notin @('napcat','llbot')){throw 'INVALID_BRIDGE_SELECTION'}
 return [string]$taskSelection.bridge
}
