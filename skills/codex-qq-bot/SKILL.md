---
name: codex-qq-bot
description: Maintain or reuse the QQ Assistant Core, its scoped knowledge/persona/memory modules, OneBot and official QQ adapters, and optional Windows deployment tools.
---

# QQ Assistant Core reuse

Read AGENTS.md, README.md or README_CN.md and docs/REUSE.md or docs/REUSE_CN.md first. The original maintained deployment is retired. Do not recreate schedules, start a bridge or infer permission for external/model actions from the existence of this source. A new operator initializes their own private configuration and credentials.

Preserve loopback authentication, group allowlists, current-message real-mention policies, private/member/persona isolation, explicit Axu/secondary opt-out routing and candidate-only reviewed persona changes. Hui CLI configuration is optional; the retired Gemini web route must stay removed. Do not downgrade a model or switch provider because a quota is exhausted.

Reuse docs/SECONDARY_PERSONA*.md, LONG_TERM_MEMORY*.md, SOCIAL_MEMORY*.md, COGNITION*.md, PERSONA_LEARNING*.md and AUTONOMY*.md alongside the corresponding profiles/set-theory modules. All optional external actions default to disabled. Never publish private chat records, credentials, textbook text, cached media or runtime evidence.

For the official SDK read QQ_OFFICIAL*.md: application registration and real OpenID bindings are prerequisites. Keep its identity namespace separate and verified=false unless actual delivery evidence supports more. For LLBot read LLBOT*.md: project authorization is mandatory; on 2026-11-03 the service refused new-user registration. Never bypass that gate.

Windows tools require explicit installation. A selected LLBot bridge makes legacy supervision read-only and recovery inert. Check actual OneBot identity, online status and all memberships independently; panel login and a zero exit code are insufficient. Protect current phone/scan confirmation and retain mutex/backoff limits.

Run npm run verify, npm run verify:knowledge and npm run audit:public. Keep offline checks separate from real platform/model acceptance. Match bilingual docs when behavior changes.
