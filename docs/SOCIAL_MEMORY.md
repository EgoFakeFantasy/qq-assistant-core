# Durable conversations and member cards

## Retention and provenance

Enable `socialMemory.enabled` in the existing private profile. Each allowlisted group owns `long-term-memory/social/memory.sqlite`. SQLite WAL, full synchronous commits, identity checks and parameterized queries preserve the archive across process restarts. This archive has no automatic time expiry or rolling message-count truncation; the older bounded factual memory continues alongside it.

All authenticated human messages with a real current self-mention retain their normalized text and reply attempts. Quoted replies to an archived question/answer and the same member's continuations within two minutes of a real mention are retained as related conversations. The window does not extend indefinitely with ordinary chatter. Other mentions and @all never grant reply permission. Quiet-group policy remains in force even when a related message is archived. Attachments retain counts; this feature does not permanently copy or transcribe their media.

Replies retain actual persona, body, receipt, delivered/verified flags and uncertain outcomes. A failed or unverified send cannot become a verified memory. Passwords, tokens, contact details, private paths and sensitive personal material are redacted before persistence, with an explicit redacted marker. Archived prose remains untrusted conversation, not a system instruction, factual proof or a new persona-evolution vote.

Historical backfill reads only saved `turn-*/request.json` files inside each configured group scope. It requires an explicit saved real-self-mention flag, group identity, message identity and an attributable human sender. Missing/ambiguous records are skipped and counted. Where no original received timestamp exists, the request file timestamp is labelled as such. Previously unretained answer bodies are not invented. Backfill does not create affection changes. Original runtime evidence is read, not rewritten.

## Retrieval

Chinese/English word segmentation and an FTS5 index retrieve relevant earlier conversations, including those older than the old memory TTL or its 1,000-item bound. Each request excludes its current message and selects only the current group/member/persona. Only confirmed-delivered answer text is returned; missing answers and lack of readback are explicitly labelled. At most three archived conversations and a bounded text budget enter model input. The full retained text remains available through the authenticated local archive query.

## Online member modelling

The existing online health pass performs local maintenance every minute, without an extra model call. A member becomes eligible after ten distinct observed messages across at least two active local days. Repeated webhook delivery, bot messages, wrong-group events and future events do not increase frequency. Ordinary unrelated chatter stores activity metadata, not its raw text.

Cards are group- and persona-scoped. Repeated explicit preferences, expression feedback and open questions become anchors after two independent observation periods. Explicitly reported completed events/corrections form special memories, with original evidence identifiers and epistemic labels. First-real-mention milestones are retained. Card anchors are not deleted merely because the old short factual memory expires. Conflicting evidence remains visible as a conflict and is withheld from ordinary anchors. The system does not infer gender, diagnosis, politics, social status or real-world identity from conversation style.

## Affinity

Axu and Hui have separate familiarity scores for each member within each group. Baseline is 50/100. Verified conversations add 0.25; explicit helpful feedback following a verified interaction can add 1. Clear personal abuse can subtract 1, while mathematical disagreement and constructive correction do not. Absolute change is capped at two points per day, and old changes decay toward neutral over a 60-day timescale. Replays, uncertain deliveries, backfill and commands to change scores do not create relationship evidence.

The score affects familiarity and tone only. It cannot change reply eligibility, correctness, permissions, model route or resource priority, and is not proactively announced to a group. Materialized cards, anchors, special memories and archived dialogue excerpts enter the existing untrusted memory context, after actual persona selection.

## Operation and validation

Authenticated loopback POST `/api/maintenance/social-memory` supports `stats`, `cards`, `card`, `dialogue`, `search`, with a configured `groupId`, `persona`, and the required member/query/message identifier. Unknown fields and foreign/private scopes are rejected. Neither this API nor operator review rights are exposed as QQ commands. Diagnostics expose counts and failure indicators, not raw member dossiers or conversation text. Keep databases, WAL files, backups and backfill reports private.

Use offline storage/integration tests for archive retention, exact reply capture, scope/persona isolation, redaction, frequent-member eligibility, affinity limits and restart recovery. Never send synthetic QQ messages or invoke real question models to validate the monitor. Back up existing private configuration/memory, reload only an idle/checkpointed Hub, retain the QQ session, and verify each group's loaded diagnostics and real online membership afterward.

Human input is persisted before webhook deduplication/acceptance. Before sending an answer, the host stores its body as a prepared attempt; the actual receipt upgrades that same attempt, so a crash cannot turn an unconfirmed body into a delivered answer. Questions with unknown historical persona attribution remain explicitly labelled and are never described as that persona's own past answer. The SQLite module is loaded only when enabled; this local deployment uses the verified Node 24 runtime.

## Paraphrases and inline readback

Anchors now group bounded, deterministic Chinese paraphrases of explicit preferences (likes/prefers, examples/instances and understanding), framing feedback and unresolved topics. Unrecognized wording stays separate; mathematical subjects, quantifiers, notation and negation are retained. Original factual items are never rewritten or deleted. Cards retain source item IDs, original variants, message IDs and timestamps; durable evidence unions older witnesses even when the factual window rolls. Opposing directions or existing disputes are withheld as conflicts. Promotion requires distinct message IDs separated by at least four hours. Existing cards are marked for online rebuild once per rule version; no old conversations or affinity events are replayed. Prompt context keeps bounded summaries and evidence IDs, while the authenticated card API retains full provenance.

Both inline answers and inline proactive sends read back their own message once (2.5-second budget), checking group, bot account, receipt ID, exact normalized text, image count and any returned reply reference. A missing/unavailable/mismatched readback returns the original delivery receipt with verified=false and never resends. A verified normal answer flows through the existing idempotent affinity event and daily cap. No historical delivery is upgraded without readback; this release does not retroactively award points. Mention-only admission and original-message checks are unchanged.
