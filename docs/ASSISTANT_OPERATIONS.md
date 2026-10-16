# Local operations

## QQ login and supervision

The included Windows supervisor starts missing Hub/account-panel processes when the computer is on AC power and the Windows user has an interactive session. If you want it to start NapCat's Node launcher as well, set napcatNodePath and napcatEntryPath in private/live-config.json to your separately installed launcher executable and index.js. Its working directory remains the launcher's directory. Do not run two independent NapCat stacks for the same account and ports.

Optional password recovery uses the configured QQ account only:

```powershell
powershell.exe -NoProfile -File deployment/store-qq-credential.ps1
powershell.exe -NoProfile -File deployment/supervise-runtime.ps1 -Once
powershell.exe -NoProfile -File deployment/install-supervisor.ps1
```

The first command prompts securely in the local terminal; do not paste passwords into QQ. The third installs a limited-privilege, interactive-user scheduled task checking every minute. These scripts are not executed by npm install, tests or cloning the repository.

Passwords are protected with Windows DPAPI CurrentUser; recovery passes only the required password representation through an anonymous stdin pipe to a fixed loopback WebUI API. The recovery state contains sanitized phases and retry times, never the password, its digest, challenge URLs or QR contents.

Recovery verifies the actual logged-in account. It prefers an eligible saved session, otherwise uses the protected password, and observes a mutex, exponential backoff, a failure limit and verification pauses. It does not repeatedly restart QQ, reset device identifiers or bypass pending verification. A CAPTCHA, phone confirmation or QR scan can still require operator action. There is no permanent-login guarantee.

npm run health distinguishes the Hub, OneBot, native QQ login, allowlisted group membership and Hub scope refresh. A running process or a successful WebUI panel login alone does not prove that the bot is online.

## Moving the deployment

Move source code and install dependencies on the destination. Create private configuration there, sign in to Codex and the platform accounts there, and import the private library from authorized local files. Windows DPAPI ciphertext is bound to its original user/system context; it is not a portable password file.

The repository does not bundle Codex, NapCat, FFmpeg, Whisper models, PDF books, existing private indexes or account sessions. General cloud deployment, other-OS account vaults and unattended reauthentication after platform risk checks are not certified by this release.
