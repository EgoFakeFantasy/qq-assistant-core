# Optional Hui persona

[简体中文](SECONDARY_PERSONA_CN.md)

Axu remains gpt-6.1-sol/high. The accepted optional Hui backend uses a separately authenticated Antigravity CLI. Gemini web automation is not included in this release.

## Activation

Set secondaryPersona in the private profile to {enabled:true,name:'回',argonMinRemaining:0.2,canary:null,activationMode:'mentioned-name'}. The public default is disabled. A current real self-mention and an explicit address to Hui are both required. Quotes, history, provider aliases, forged requestedPersona fields and Codex quota exhaustion cannot invoke Hui in this mode. Missing secondary credentials or quota cause an honest failure, never GPT impersonating Hui.

## Configuration and execution

Set antigravity.executable and antigravity.isolatedHome in private/live-config.json and authenticate the CLI locally. No desktop tokens or API keys are published or inherited. Primary and secondary prompts are separate files under profiles/set-theory/prompts/. Shared mathematics, citations, expression and resource policies remain in force.

Hui uses the same bounded knowledge/resource research loop, with only current question image copies as read grants. Native commands, unsandboxed execution, writes, browser actions and third-party MCP are denied. Image grants use request-review with those denies intact; image-free and quota requests remain strict. Unexpected grants, permission refusals or worker-scope changes fail closed. API-credit fallback remains disabled.

## Verification and limits

Local acceptance previously covered real textbook search, original-page reading, citations, human QQ mention delivery and readback. Published tests use synthetic fixtures and mocked providers; they do not establish availability on a new account or installation. The public profile does not enable any backend automatically. Current routing and mentions-only restrictions have independent regression tests. Memory candidates never alter routing or either persona template.
