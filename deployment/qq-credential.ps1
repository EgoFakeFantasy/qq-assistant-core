function Get-TaskQqPasswordMd5 {
 param([string]$CredentialPath)
 $taskProtected=Get-Content -LiteralPath $CredentialPath -Raw
 $taskSecure=ConvertTo-SecureString $taskProtected
 $taskPointer=[IntPtr]::Zero
 try {
  $taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
  $taskPlain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  $taskBytes=[Text.Encoding]::UTF8.GetBytes($taskPlain)
  $taskHasher=[Security.Cryptography.MD5]::Create()
  try { $taskDigest=$taskHasher.ComputeHash($taskBytes); return ([BitConverter]::ToString($taskDigest)).Replace('-','').ToLowerInvariant() }
  finally { [Array]::Clear($taskBytes,0,$taskBytes.Length);$taskPlain=$null;$taskHasher.Dispose() }
 } finally {if($taskPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)};$taskSecure.Dispose();$taskProtected=$null}
}
