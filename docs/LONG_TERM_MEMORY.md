# Long-term memory and persona candidates

[简体中文](LONG_TERM_MEMORY_CN.md)

Group-scoped memory can inform answers. Persona changes are candidates only and never apply automatically. Memory cannot change models, routing, tools or group reply policy.

## Collection and evidence quality

Observe human text only after authentication, normalization, robot filtering and deduplication. Collection makes no extra model calls or QQ writes; nonmentions in mentions-only groups remain silent. Ordinary answers may select at most three exact safe spans from the current human message.

Preferences and style feedback are scoped to the member and group. Corrections, claims, episodes and open questions stay within the group. Ordinary definitions and tentative assertions are claims, not explicit corrections or verified knowledge. Episodes require an explicit event and completion assertion. Weak legacy episodes retain their evidence but are withheld from retrieval. Quotes, credentials, URLs, paths and permission/persona commands are excluded conservatively; this is not a proof against arbitrary natural-language injection.

New memories preserve mathematical Unicode verbatim; normalization is used only for safety checks and term matching, never to rewrite symbols such as ℕ or 𝒫.

## Storage and candidates

Each group runtime has its own long-term-memory/ directory. memory.json is bounded to 1,000 records and 3 MiB, with serialized atomic writes, bounded Windows sharing-lock retries, and fail-closed malformed/link handling. Preferences/style feedback expire after 90 days; new claims/open questions after 30; explicit corrections/eligible episodes after 60. Legacy expiry dates remain unchanged. Retrieval and bot repetition never extend expiry.

Status exposes only counts, quality rejection counters and faults. reviewPending counts withheld legacy episodes; claims includes effective classification of legacy records. Opening the new version does not rewrite original text or evidence. Conflicts retain both reports without deciding mathematical truth.

persona.candidate.json / persona.candidate.md require explicit Axu style feedback from the same member in at least three distinct four-hour slots across two Sydney dates. At most two member-in-group proposals are produced, each requiring counterevidence review. Hui feedback cannot reinforce Axu. Candidates never enter prompts, rewrite persona.md or alter persona templates. autoApply/applied remain false; insufficient evidence yields no changes.

## Local replay

Run npm run replay:memory -- --input private/events.jsonl --out-dir private/replay-new --bot-id BOT_ID. Each line contains a sourced local event: groupId, senderId, messageId, text and millisecond at. The output directory must be new and inside private/. Query before observing each event; use the final 25 percent for later queries. There are no model, network or QQ-send calls. Reports contain aggregate counts; extracted memories remain private.

Development replay compared 1,666 historical requests and 418 later queries: both variants had four queries with recall and zero observed scope/current-source/future-source leaks. Of ten existing records, six are displayed as tentative claims and three weak episodes are withheld without rewriting evidence. Saved request snapshots are not a complete transcript. Rules were adapted on this dataset, so this is not a sealed benchmark or evidence of improved answer accuracy. Raw chat, replay text and private acceptance reports are excluded from publication.

## Verification and operation

Run npm run verify and npm run audit:public. Synthetic regressions cover memory, routing and group policy. Reload only an idle Hub, preserving QQ sessions, private profilePath and group settings. The primary remains gpt-6.1-sol/high; Hui requires a real current self-mention plus an explicit name address. Candidates never apply automatically.
