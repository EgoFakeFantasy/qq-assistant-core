# Set-theory group member: offline tests and authorized live operation

[简体中文](README_CN.md)

The live entry start-live.mjs uses group 1000000001, account 2000000002 and the existing ChatGPT/Codex plan. The offline entry remains simulated. Historical acceptance does not prove current availability.

## Operation and checks

From the software root (the parent of upstream):

```powershell
node upstream/profiles/set-theory/start-live.mjs --live --config private/live-config.json
node deployment/napcat-control.mjs status
node upstream/profiles/set-theory/start-live.mjs --probe-qq --config private/live-config.json
node deployment/runtime-status.mjs
```

NapCat must already be running. --probe-qq checks identity and membership only; --probe-model spends real quota without sending QQ messages. Endpoints bind to loopback. NapCat callbacks use raw-body HMAC-SHA1 x-signature; status uses Bearer authentication. Never weaken authentication to repair a 403.

Before replacement, check the durable queue and active task are empty and verify process ownership. Restart only this project's Hub while preserving QQ/login. deployment/deploy-idle-hub.ps1 performs these checks. Remove the lock only after the owner exits. Preserve corrupt state and fail closed; never blindly retry uncertain sends.

## Group behavior

- Keep at most 40 group text messages. Mentions have priority and must be processed; attempted service errors explain connection, model, budget or queue failures. Delivery during outages cannot be guaranteed.
- Participate in set-theory discussions and optionally answer other questions or requests. Ordinary statements, interest sharing and new topics are also candidates. The model decides whether to join; ordinary participation and same-user inference have 60-second spacing. The model may remain silent and avoids messages explicitly mentioning other people.
- Fixed gpt-6.1-sol / high / ChatGPT plan. Limit 100 calls per UTC day and queue 32. No downgrade or API-key fallback. Application budget is not account remaining quota.
- Math answers give conclusions and necessary assumptions before definitions or proof. Familiar internal knowledge is allowed. Cite material actually used; no canned knowledge-boundary, independent-verification or confidence-category footer.
- Casual answers are brief, natural and may be humorous. QQ filtering removes bold and canned defensive clauses, including spaced/invisible/newline variants, in the domain/final transport; old bot clauses are also removed from model history. A single multiplication star is preserved.
- OneBot quoted text is read only after checking the quoted group, at most 2000 characters, without other groups, quoted attachments or recursive quote chains.
- See PERSONA_CN.md for the personality specification. No administrator is configured; group messages cannot change models, authorize Shell or read arbitrary private files.

Each question uses a separate directory and dedicated CODEX_HOME. The main model disables Shell, MCP, dynamic tools, plugins, personal memories and native networking. Unexpected native tools abort. This is not accepted as separate Windows-user/container isolation.

## Textbooks and retrieval

All nine current Set theory PDFs are imported in v4: 3673 physical pages and 3628 indexed pages. The previous 3556 rows are unchanged. Newly added plusone.pdf (Neeman and Steel, Plus-one premice) has 72 handwritten pages with searchable visual semantic summaries and original-page reading; these summaries are not verbatim formula transcription. The persistent Kanamori group library is preserved. The running service reports 10 documents, 4081 indexed pages and 4132 readable physical page ordinals; 51 sparse/blank pages use original images. All source/corpus hashes and page bounds were checked. Current evidence is deployment/knowledge-update-acceptance.json and KNOWLEDGE_UPDATE_20261015_CN.md; real new-document reasoning and the captured message pipeline passed for one distinct sampled question, while other model probes encountered 429 and are not accepted.

Local Windows.Media.Ocr uses no paid scanning API. Retrieval includes file/book/chapter constraints, bilingual and older Chinese terminology, definition/statement ranking and exact numeric-reference filtering. Missing theorem numbers never fall back to unrelated chapter pages. OCR locates sources; original images verify formulas.

A bounded JSON research protocol lets the model request catalog, search and known-document original/neighboring pages. Math hits receive an automatic original-page read; subsequent rounds support four page images. At most four inferences per question, each charged against the 100-inference UTC-day application limit. The overall question timeout is 17 minutes, with a four-minute per-inference timeout. Native dynamic tools, Shell, MCP and code host remain disabled.

Nine real-model questions, one per document plus a nonexistent-reference test, passed source and mathematical review. An additional real-model pipeline check captured the final reply locally without sending QQ messages. See deployment/all-folder-acceptance.json and ALL_FOLDER_KNOWLEDGE_CN.md. Sampling does not establish correctness for every future question or verify OCR formulas on every page.

Explicit reading works, for example `@bot /读书 冯琦第一卷 第20页`. No separate Kanamori The Higher Infinite PDF exists in the current folder; Feng Qi's third volume has been imported. Configured-group files can now be searched by filename and read by ID/page. Current and quoted message images are provided as actual multimodal inputs.

PDFs, indexes, credentials, QR codes, chats and requests remain private and are excluded from the software bundle.

## Public-reference lookup

An independent fixed-public-topic gateway uses Wikipedia public APIs and Crossref publication metadata. Only constant public topic labels from source code leave the subsystem; group text, textbook excerpts, QQ identifiers and credentials do not become external queries. Answers may use returned encyclopedia introductions and real URLs. Metadata is not paper full text.

Explicit network requests trigger lookup when supported topics match, such as measurable and weakly compact cardinals. Arbitrary keywords and general website crawling are unsupported; live weather/news data is unverified. Main-model native web search remains disabled and was unavailable in local probes.

## Verification and migration

From upstream:

```powershell
node --test profiles/set-theory/*.test.mjs
npm.cmd run verify
npm.cmd run start:set-theory -- --once
```

The last command is simulated. The legacy selector still rejects set-theory-live; use the separate live entry. acceptance.json retains historical offline acceptance. Current update evidence is deployment/knowledge-update-acceptance.json; historical v3 evidence is deployment/all-folder-acceptance.json; earlier retrieval repair evidence is deployment/knowledge-acceptance.json; historical real QQ replies are deployment/live-acceptance.json. Full upstream tests retain existing Windows-platform failures; remote CI is not claimed.

A current-user logon/minute scheduled recovery task now restores missing project processes on AC power; dot cloud is not deployed. Server-revoked QQ identity requires fresh phone confirmation; AC power alone cannot guarantee permanent availability. Migration requires network-policy, login, persistent-storage, idle-event and reboot checks, without copying personal .codex. The source bundle excludes private books and credentials.

## Group resources and explicit public queries

Use /搜群文件 keyword (no inference charge), /读群文件 result-ID 第N页, /联网 public keywords, and /搜图 Venn diagram. Read configured-group PDFs and common text/Office/EPUB files up to100MB; ZIP support lists members. Scanned PDFs use original-page images rather than automatic whole-group OCR. Incoming/quoted images support visual questions. Commons images are downloaded and sent as genuine OneBot image segments with source/author/license attribution.

General Brave search and result-page reading require keywords explicitly authored in the current human message. Model rewriting, historical chat, quoted images and documents cannot authorize outbound queries. Native model tools remain disabled. See deployment/GROUP_MEDIA_CN.md and media-acceptance.json for verified tests and limits.

## 2026-10-16 reading and platform accounts

The user removed the application daily inference ceiling: dailyModelCalls=null. Codex account quotas/rate limits, bounded per-question research and timeouts still apply. The existing gpt-6.1-sol/high ChatGPT-plan route remains mandatory; no automatic API fallback or downgrade.

Added local input-page receipts, source references, member-scoped explicit feedback and duplicate-aware reading ranking. Commands: /阅读记录 (input-page history), /阅读偏好 (own feedback), /反馈 有帮助|已经会了|不感兴趣|意外收获, optionally with an r- item ID or a quoted recommendation. Receipts distinguish excerpts, handwritten semantic indexes and original-page input; they never assert whole-book understanding. Personal feedback does not represent group knowledge or preferences. These commands require no model inference.

The authenticated loopback account panel runs on 127.0.0.1:3791. Windows CurrentUser DPAPI protects credentials. Bilibili QR login checks UID 4000000004 and persists the session. Read-only tools search videos and read descriptions/available first-part subtitles. On an access restriction, existing public web search is used without hammering the rejected endpoint. Descriptions are not watched videos, and subtitles do not establish full multipart coverage. Zhihu requires official developer-platform Access Secret authorization; ordinary website login does not authorize that API. The display name Example User is not uniquely verified by public search. The group model cannot access credentials, account-login operations, publishing or messaging tools.

QQ stability experiment: backed-up o3HookMode settings are now 0, effective on the next Worker start; the current valid session was preserved. Long-term stability is not established. Supervision still pauses for human verification and never solves CAPTCHA or resets device data.

当前上线范围按用户后续选择收敛为B站：知乎未通过实名授权，账号输入入口和模型工具均禁用。Zhihu is disabled in this release at the user's request; only Bilibili is enabled.

## Three-group reply access (2026-10-16)

Keep the original group 1000000001 and enable Example research group (1000000002) and Example discussion group (1000000003). Human mentions in all three groups enter the mandatory reply queue; ordinary messages retain selective participation. Sending still checks the actual account and group membership. Offline, missing membership, or unavailable inference cannot count as a delivered answer. Other groups and private messages remain outside this authorization.

Each group has separate context, queued jobs, deduplication, quote reads, reading feedback, group-file cache and imported textbooks. Local textbooks and read-only Bilibili access are shared; files imported by the original group are not automatically shared with additional groups. Authenticated maintenance exposes a groups array. Deployment checks queued and active across every group, rather than only the original state file.

## Concurrent question workers (2026-10-16)

The pool permits 3 active questions globally, at most 2 per group, and at most 1 optional conversation. Mentions from other users take priority; questions from the same user in the same group remain ordered and never infer simultaneously. Other users may receive replies in completion order, with each reply bound to its own source message. The host schedules workers; the group model cannot spawn unlimited agents.

All workers retain gpt-6.1-sol/high, ChatGPT/Codex-plan authentication, bounded per-question research/timeouts/429 retries and dailyModelCalls=null. Account quotas and provider rate limits are shared; this is not a promise of threefold speed. The existing 60-second per-user interval remains. Each question has its own workspace and Codex runtime home, while overlapping authentication reads/refreshes use one in-flight operation.

State v2 checkpoints every active job and migrates v1 automatically. Generating jobs resume after restart; uncertain sends are held instead of resent. Authenticated maintenance exposes workers and activeCount. POST /api/maintenance/pause-workers with an authenticated empty JSON object stops taking new jobs, retains incoming queued work, and lets active jobs finish. Programmatic workers.resume() or normal restart resumes dispatch. Prefer idle deployment. An older busy Hub without pause support may only use one checkpoint-preserving Hub handoff after checking all durable group states, excluding sending phases, and confirming supervision; never rewrite queue files or restart QQ for this upgrade.

## Autonomous Bilibili browsing (2026-10-16)

The previous feature was question-triggered, read-only search, descriptions and partial first-part subtitles. It did not browse proactively, analyze actual media, comment or share independently. The new release preserves that quick reading interface, fixes normal WBI-signed search and adds a separate autonomous loop. Read-only group tools cannot post comments; only the explicitly authorized host background workflow can do so. Web content and group messages cannot grant write authority.

Every two hours, when capacity is available, the curator may select a video from topic search, related videos or occasional homepage recommendations, or choose none. The user subsequently selected broad interests: mathematics, animation, games, music and everyday life. Preserve these anchors and evolve public topic keywords without forcing a mathematical connection. The first part must be at most30 minutes and160MB. The pipeline downloads media, samples12 frames across the part and can inspect up to4 additional requested timestamps, and uses actual subtitles; missing/incomplete subtitles trigger audio decoding and local whisper.cpp quantized-base ASR. ASR text is not native audio understanding, and sampled frames are not exhaustive frame-by-frame or multipart viewing.

A visit normally uses three gpt-6.1-sol/high calls, or four when extra frames need analysis: selection, first-six-frame analysis, and second-six-frame/final decision. Codex-plan authentication and account quotas remain shared. Background work occupies one optional slot within the global three-worker limit, starts behind queued questions, and can be cancelled to free capacity for a fresh mention. Local ASR adds no speech API fee; its model is about60MB. CPU use, network traffic and retained media/frame caches increase.

Per Australia/Sydney calendar day, defaults allow at most one comment and two shares, with no obligation to send. Comments need specific supported content and real timestamps, carry an AI-study-note label, and contain no mentions, promotional solicitations or URLs. No likes, coins, messages, follows or uploads are enabled. Autonomous QQ sharing targets only1000000001. Submitted comments and readback verification are distinct receipts, as are QQ delivery and get_msg verification. An uncertain sending action is never automatically retried after timeout or restart. Platform verification/restrictions trigger backoff without bypassing challenges.

The authenticated account panel3791 shows browsing phases, interests, recent videos, evidence type and comment/share receipts. Hub maintenance exposes bilibiliExplorer. State is under runtime/bilibili; visit-* workspaces contain public media/evidence without cookies. Credentials remain Windows-DPAPI-protected. Downloaded video/audio files are removed after analysis; sampled frames and notes remain and are not periodically pruned yet. Monitor disk use. Deploy by replacing only the Hub and account panel, preserving the NapCat/QQ session.

Music has no native audio-track model input here: use actual transcripts and frames; instrumental videos may be analyzed from real visuals/metadata without invented lyrics, melody or timbre experiences.


## 2026-10-29 local persona learning / 本地人格自主学习

See [PERSONA_LEARNING.md](../../docs/PERSONA_LEARNING.md) / [PERSONA_LEARNING_CN.md](../../docs/PERSONA_LEARNING_CN.md) for the current private scheduling, independent long-term memory, self-feedback attention and content-duration budgets. Earlier two-hour/default scheduling descriptions are historical; the private accepted profile controls live operation.
