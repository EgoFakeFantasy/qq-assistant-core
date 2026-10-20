# Local operations

## QQ login and health

QQ login is an operator action in NapCat. Automatic password login, credential collection and scheduled recovery scripts are retired from this edition. Existing private installations are not changed by this source release.

npm run health distinguishes panel authentication, actual OneBot online status, account identity, group membership and Hub readiness. A panel login or process alone is not QQ online evidence.

## Moving the deployment

Move source code and install dependencies on the destination. Create private configuration there, sign in to Codex and the platform accounts there, and import the private library from authorized local files. Windows DPAPI ciphertext is bound to its original user/system context; it is not a portable password file.

The repository does not bundle Codex, NapCat, FFmpeg, Whisper models, PDF books, existing private indexes or account sessions. General cloud deployment, other-OS account vaults and unattended reauthentication after platform risk checks are not certified by this release.
