# Antigravity secondary persona

Implementation status: experimental and not enabled on the configured live bot. Unit coverage and one real seeded-textbook answer passed; complete live research and QQ delivery acceptance remain pending.

One QQ account, NapCat login, OneBot webhook and delivery transport can serve two explicitly identified model personas. The primary stays gpt-6.1-sol/high. The optional secondary, “回” (Hui), is lively and curious while retaining the same mathematical assumptions, proof and citation requirements.

## Activation

- Group questions can delegate when the Codex quota endpoint confirms zero remaining, or an actual inference reports usage_limit_reached/insufficient_quota.
- While Codex remains available, only an explicit invitation in the current message invokes Gemini: “请 Gemini 人格出来回答”, “回，请解释共尾度”, or /gemini. Model comparisons, negations, history and quoted instructions do not invoke it.
- Ordinary 429s, timeouts, authentication failures and malformed output are not exhaustion. Unknown quota retains the primary.
- One message has one answering persona. Different users can use existing concurrent workers; questions from the same user remain ordered.
- Routing covers group questions and their resource-research loop. Independent Bilibili and scholarly background curators retain their existing Codex configuration.

The host adds a conspicuous first-persona notice per group. Exhaustion produces an explicit quota-switch notice; an invitation explicitly does not imply exhaustion. Later replies retain a name and actual model label. Notices are remembered after confirmed delivery and serialized across concurrent completions.

## Configuration

Opt in through private profile.json:

~~~json
"secondaryPersona": {
  "enabled": true,
  "name": "回",
  "argonMinRemaining": 0.2
}
~~~

Configure the official CLI in private live-config.json:

~~~json
"antigravity": {
  "executable": "C:/path/to/agy.exe",
  "isolatedHome": "private/antigravity-home"
}
~~~

Install Antigravity CLI through Google's official instructions. It reuses the operating-system keyring's existing Antigravity sign-in without copying desktop tokens, setting a Gemini API Key, or controlling an ongoing desktop conversation. Complete normal CLI authentication if no reusable sign-in exists.

The host reads command.data.groups.buckets.remaining_fraction using agy -p /usage --output-format json, and Codex account/rateLimits/read. These reads start no inference and use a 60-second cache with coalesced concurrent reads.

Positive Argon quota at or above the configured threshold selects gemini-4-argon-high; otherwise available gemini-3.8-flash-high is used. If Flash is depleted but Argon remains positive, Argon is used. Zero, unknown and disabled buckets remain distinct; a model catalog alone does not prove Argon eligibility. Both run at high. Exhausted or unconfirmed secondary quota stops that request without buying credits.

## Resources and execution boundaries

Both personas share the existing knowledge catalog, original-page lookup, group-file, public-web, Bilibili-read and image gateways. Gemini returns structured knowledgeRequests; the host executes its existing scoped tools and returns evidence. This does not grant arbitrary host commands or unrestricted textbook-directory access. Existing source, URL, file and image checks remain authoritative.

The official CLI runs in a separate HOME/USERPROFILE for each question and explicitly registers that question workspace with a read-only allow rule, with a pinned model and JSON schema. Native commands, unsandboxed execution, file writes, browser actions and third-party native MCP are denied. Plugin capabilities remain behind the existing host gateway. Personal AI-credit fallback is off and API keys are not inherited. Prepared original-page images must stay in the question workspace. CLI refusal, timeout or failure is never accepted as a successful answer.

At most one quota-driven switch is charged inside the existing four/six-call question ceiling. Only the original QQ transport writes messages, retaining group scope, formatting, cute stickers, long-reply cards, durable receipts and no retry after an uncertain write. Health checks invoke neither question model.

The verified CLI 1.4 settings use the boolean false for allowNonWorkspaceAccess and useG1Credits. The CLI may omit these false defaults when persisting its settings. Each command receives a private log; a settings-load failure rejects even a nominal SUCCESS result.

## QQ login recovery

The provider router never starts a second NapCat session. The Windows supervisor retains its saved-password recovery, mutex, backoff and challenge pause. A rotated local WebUI token is read from NapCat configuration automatically after an authentication failure; it is never a human CAPTCHA. This does not bypass Tencent challenges or guarantee a server session will never expire. An authenticated online session clears old challenge state in the configured local supervisor.

## Sources

- [Antigravity headless mode](https://antigravity.google/docs/cli/headless/)
- [Antigravity CLI installation and authentication](https://www.antigravity.google/docs/cli/install/)
- [Antigravity permissions and isolation](https://www.antigravity.google/docs/permissions?tab=cli)
- [Codex app-server quota interface](https://learn.chatgpt.com/docs/app-server)

## Gemini web automation retired (2026-10-22)

The operator canceled the web proxy plan. The Edge extension, automatic worker-tab scripts, web bridge/client and web acceptance scripts have been removed. The old extension alarm could recreate a dedicated Gemini page every 30 seconds even when production web routing was disabled. Remove the already-loaded extension from Edge once; deleting its source does not unload an in-memory service worker. Do not restore, reload or re-enable this route during supervision. The accepted Antigravity CLI, private profilePath, group reply policies and humanities routing remain in place.

## Local scoped acceptance

While secondaryPersona.enabled remains false, an operator may configure a short-lived canary with groupId, prefix and expiresAt (UTC milliseconds). Only a fresh direct self-mention in that group, beginning with the exact prefix and expiring within 30 minutes, can use Gemini for acceptance. Other explicit summons return a clear disabled status rather than silently using GPT. Continued research fails closed after expiry. Ordinary requests retain the primary model, and group 1000000004 keeps its prior mention-only gate.

For CLI acceptance, enable production and remove the canary only after real textbook search/read/citations and a human QQ mention-to-delivery-readback test pass. Reload only an idle Hub and preserve QQ. The retired web extension is not part of this workflow.


## Local Windows CLI read correction (2026-10-17)

CLI 1.4.0 soft-denies headless reads under strict on this machine even with exact read_file rules loaded. A synthetic comparison retained identical command, write, native-web and MCP deny rules and changed only authorized-image rounds to request-review: reading succeeded, while a real write attempt remained denied and created no file. Image-free turns and quota reads retain strict. Never skip permissions, change user-global settings or bypass browser origin permissions.

Normalize Windows grant paths by removing the drive prefix and using forward slashes. Grant only each actual image. The native workspace contains only read-only copies of current images; CLI HOME stays outside that workspace. Fingerprint workers-v4 by question directory, original image paths and content hashes, preserving older homes. Explicitly create a project bound to the current workspace; do not expose the original question directory, other rounds or arbitrary local files.

Step errors, terminal denied_actions and soft-denying log entries fail the attempt before accepting an empty SUCCESS. Never automatically replay denied material. The real client correctly identified 7142 and a red square in a synthetic image; this is not textbook acceptance. Forty-three focused tests pass. Production remains disabled pending real textbook search/read/citations and a human QQ mention-to-delivery-readback test.

Fresh self-mentions additionally recognize explicit Hui identity requests such as 请以回的身份回答, 用回的人格来解释 and 请回解释一下. Ordinary 请回答, 请回复 and 请回来回答 do not summon Hui; these single-character forms require an actual self-mention, and group 1000000004 remains mentions-only. Browser origin denials also block extension, alternate-browser and CLI-web workarounds. The separate CLI backend uses only its own authorized session. Keep all changes local and unpublished.


## Local persona texts (2026-10-17.3)

The default primary side is 阿序 (Axu). Its operator-provided style lives in profiles/set-theory/prompts/primary-style.txt; persona.mjs adds the separate primary identity while retaining resource, permission and operation rules. prompts/hui-persona.txt stores the operator-provided Hui text. Gemini routing removes the primary identity prefix before appending Hui, while retaining shared mathematical, plain-text, expression, citation and tool policies. Reload only an idle Hub after edits; preserve NapCat/QQ. Updating persona text does not enable an unaccepted Gemini backend. Private exports live under the deployment private/prompt-exports/2026-10-17.3 directory and remain unpublished.


## Current self-mention and explicit Hui name only (2026-10-18, local)

With secondaryPersona.activationMode=mentioned-name, Gemini requires both a real self-mention in the current message and an explicit address to the persona name. Name vocatives, identity requests, direct named requests and an @ /name command qualify. Quotes, history, ordinary reply verbs, Gemini/Argon aliases and forged requestedPersona fields cannot replace those conditions. Ordinary requests stay with Axu, including quota exhaustion; an unavailable Gemini never becomes GPT impersonating Hui. Both sides retain the same knowledge and resource tools. Production still requires real textbook and human QQ delivery/readback acceptance; use the bounded canary first. The deployment uses a private profilePath and reloads only a checkpointed idle Hub, preserving QQ.


The accepted local deployment enables the CLI route in its private profilePath, clears the expiring canary, and preserves mentioned-name mode. The source default remains disabled for new deployments. Web readiness and authorization are separate; an accepted CLI route does not authorize or enable the Gemini website.


## Topic-based Hui for literature, history and philosophy (2026-10-21, local)

The current private deployment additionally enables secondaryPersona.routeHumanities=true while preserving enabled=true, activationMode=mentioned-name, canary=null and the existing profilePath. Unconfigured deployments retain their prior behavior; source defaults remain disabled.

Only a current group message already eligible under the existing reply policy may select Hui from literature, history or philosophy topic cues. The switch never makes a topic match a new mandatory-reply entry point. Group 1000000004 still requires a real current self-mention first; other groups retain adaptive timing, quote and other-mention checks. A real current @ plus the Hui name still supports mathematics; an explicit Axu address or Hui opt-out retains the primary persona.

Selection reads only the current message, not history, quoted-message metadata or forged requestedPersona fields. Operational histories, code blocks and mathematical proof tasks do not switch on a generic history keyword; explicit history-of-mathematics or mathematical-philosophy discussions may use Hui. Unrecognized or ambiguous text conservatively stays with Axu. This phase affects group replies only; friend DMs preserve Axu and their existing isolation.

The first topic-selected reply truthfully identifies topic selection rather than an explicit summons or Codex exhaustion. Hui keeps the accepted Antigravity CLI, knowledge base and resource tools; the web route remains disabled. An unavailable Gemini never becomes GPT impersonating Hui. Long-term-memory persona tags follow the same selection.

Reload only an idle Hub, preserving QQ/NapCat, the knowledge base and all unrelated private fields. Replay uses synthetic group events and mocked models without sending real group probes.
