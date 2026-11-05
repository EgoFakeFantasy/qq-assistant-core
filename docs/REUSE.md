# Complete reuse and clean deployment

Reusable implementation is preserved from a retired deployment. Example identities are fictional. Credentials, conversations, member records, books, indexes, runtime state and maintenance logs are excluded. Cloning creates no old deployment or schedule.

## Clean installation

Use Node.js 24+, Python 3.12 and an authorized Codex CLI. Optional Hui requires a legitimately installed and authenticated Antigravity CLI. Third-party executables and login state are not distributed.

    git clone https://github.com/EgoFakeFantasy/qq-assistant-core.git
    cd qq-assistant-core
    npm ci --ignore-scripts --no-audit --no-fund
    python -m pip install -r requirements.txt
    npm run verify
    npm run verify:knowledge
    npm run audit:public
    npm run init -- --bot-id 2888888888 --group-id 1888888888,1888888889

Supply your own account and allowed groups. Initialization creates private configuration, an empty corpus and random credentials, refusing overwrite. config/research.example.json documents optional features/budgets with autonomy disabled.

## Feature map

| Feature | Entry point and guide |
| --- | --- |
| PDF/OCR, original pages, group files, web and scholar retrieval | profiles/set-theory/knowledge*.mjs, resource-session.mjs; provide books yourself |
| Axu/Hui, topic routing and CLI | persona-router.mjs, humanities-routing.mjs, antigravity-cli.mjs, prompts/; SECONDARY_PERSONA*.md; the web proxy is retired |
| Group/private isolation | live-onebot.mjs, live-private-onebot.mjs, group-reply-policy.mjs |
| Long-term/social memory | long-term-memory.mjs, social-memory.mjs, memory-anchor-semantics.mjs; LONG_TERM_MEMORY*.md and SOCIAL_MEMORY*.md |
| Cognition, attention and learning | src/domain/, learning-memory.mjs, persona-load.mjs; COGNITION*.md and PERSONA_LEARNING*.md; candidates never approve themselves |
| Autonomous reading and platforms | background-scheduler.mjs, Bilibili/scholar modules, account vault; AUTONOMY*.md |
| Official QQ SDK | src/channels/qq/official-*.js, official-runtime.mjs; QQ_OFFICIAL*.md |
| LLBot | llbot-runtime.mjs, prepare-llbot.mjs, deployment/; LLBOT*.md |
| Windows operations | DPAPI, mutexes, backoff, login inspection, OCR, supervision in deployment/; task installation is explicit |

## Connection and verification

Independently install a compatible OneBot bridge and apply generated settings, retaining loopback and authentication. Start manually with npm run start:live and inspect with npm run health. See ASSISTANT_OPERATIONS*.md.

Official preparation:

    node scripts/prepare-qq-official.mjs --source private/live-config.json --destination private/qq-official-config.json
    node scripts/check-qq-official.mjs private/qq-official-config.json

Create an application, configure AppID, supply QQBOT_APP_SECRET locally and bind actual group/member OpenIDs. Official and numeric QQ identities have different namespaces; never merge by display name. Complete platform authorization before starting.

For LLBot, verify/unpack the official archive into private/llbot/vendor/v8.3.2 and run node scripts/prepare-llbot.mjs . private/llbot/vendor/v8.3.2. Preparation does not start/forward. A legitimate Auth Token and explicit -QqPath are required. On 2026-11-03 registration was closed; new operators without an existing legitimate token cannot complete this route. Never bypass authorization.

Offline checks make no live model calls or group sends. Actual acceptance requires account, online status, memberships and media capabilities separately. Official acceptance is not get_msg readback; uncertain writes never retry automatically. New operators configure their own accounts/material and explicitly enable optional actions, retaining candidate/review boundaries.
