$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'json-process.ps1')
$taskFixture=Join-Path $PSScriptRoot 'test-fixtures/json-process-fixture.mjs'
$taskNode='C:\Program Files\nodejs\node.exe'
$taskOutput=Invoke-TaskJsonProcess -Executable $taskNode -Arguments @($taskFixture)
if(-not $taskOutput.ok -or $taskOutput.label.Length -ne 8){throw 'UTF8_JSON_TEST_FAILED'}
$taskFailed=$false
try{Invoke-TaskJsonProcess -Executable $taskNode -Arguments @($taskFixture,'--fail')|Out-Null}catch{$taskFailed=$_.Exception.Message -eq 'JSON_PROCESS_FAILED'}
if(-not $taskFailed){throw 'EXIT_CODE_TEST_FAILED'}
@{tests=2;passed=2;utf8AndStderr=$true;exitPropagation=$true}|ConvertTo-Json -Compress
