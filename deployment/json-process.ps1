function Invoke-TaskJsonProcess {
 param([string]$Executable,[string[]]$Arguments,[int]$TimeoutMs=60000)
 $taskStart=[Diagnostics.ProcessStartInfo]::new()
 $taskStart.FileName=$Executable
 foreach($taskArg in $Arguments){if($taskArg.Contains('"')){throw 'INVALID_JSON_PROCESS_ARGUMENT'}}
 $taskStart.Arguments=(($Arguments|ForEach-Object {'"'+$_+'"'}) -join ' ')
 $taskStart.UseShellExecute=$false
 $taskStart.CreateNoWindow=$true
 $taskStart.RedirectStandardOutput=$true
 $taskStart.RedirectStandardError=$true
 $taskStart.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
 $taskStart.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
 $taskChild=[Diagnostics.Process]::new()
 $taskChild.StartInfo=$taskStart
 try {
  if(-not $taskChild.Start()){throw 'JSON_PROCESS_START_FAILED'}
  $taskOutRead=$taskChild.StandardOutput.ReadToEndAsync()
  $taskErrRead=$taskChild.StandardError.ReadToEndAsync()
  if(-not $taskChild.WaitForExit($TimeoutMs)){throw 'JSON_PROCESS_TIMEOUT'}
  $taskOut=$taskOutRead.GetAwaiter().GetResult().Trim()
  $taskErr=$taskErrRead.GetAwaiter().GetResult()
  if($taskChild.ExitCode -ne 0) {
   # Never copy stderr or credentials to the supervisor event stream.
   $taskCategory='JSON_PROCESS_FAILED'
   foreach($taskPattern in @('MODULE_NOT_FOUND','INVALID_PROTECTED_CREDENTIAL','CryptographicException','ConvertTo-SecureString','ParameterBindingException','FileNotFound')) {
    if($taskErr -match [regex]::Escape($taskPattern)){$taskCategory='JSON_PROCESS_FAILED_'+$taskPattern;break}
   }
   throw $taskCategory
  }
  if(-not $taskOut){return $null}
  try{return ($taskOut|ConvertFrom-Json)}catch{throw 'JSON_PROCESS_INVALID_RESPONSE'}
 }finally{$taskChild.Dispose()}
}
