# LLBot OneBot adapter

profiles/set-theory/llbot-runtime.mjs supports LuckyLilliaBot v8.3.2 configuration. Account and group settings come from a new operator's private profile; example identities are fictional.

## Preparation

Initialize as documented in REUSE.md, verify an official release archive against GitHub metadata, unpack into private/llbot/vendor/v8.3.2 and run:

    node scripts/prepare-llbot.mjs . private/llbot/vendor/v8.3.2

Preparation creates separate private runtime/manifest/bridge files, retaining profilePath, memoryRoot and authentication. Existing files are never overwritten. WebUI binds 127.0.0.1:3080; OneBot retains the configured port. Milky, Satori, WebSockets, offline reports and HTTP POST forwarding start disabled.

## Project authorization and startup

LLBot's project Auth Token is distinct from QQ credentials, the local WebUI password and OneBot/Hub keys. A legitimate token belongs in private vendor bin/llbot/data/auth_token.txt, outside version control. On 2026-11-03 https://auth.luckylillia.com refused new registrations. Without an existing legitimate token, this route cannot complete. Never bypass authorization.

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File deployment/start-llbot.ps1 -QqPath 'C:/Program Files/Tencent/QQNT/QQ.exe'
    node deployment/runtime-health.mjs

Startup checks manifest, identity and token, uses supervisor/login mutexes and protects active sessions. With llbot selected, supervision only monitors and legacy recovery exits. A spawned process is not online verification. Independently verify identity, online status and all configured memberships before an operator enables forwarding.

## Verification boundary

Offline configuration/HMAC/current-mention/persona checks make no live model calls or group sends. Panel readiness is insufficient to prove QQ online or restriction removal. Images, attachments, historical readback and OneBot extensions need separate live acceptance. Third-party binaries, login state and private records are excluded.
