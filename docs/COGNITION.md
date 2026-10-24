# Attention and reviewed persona evolution

## Design and provenance

This is an original JavaScript implementation informed by [dd19-bot](https://github.com/42Noveland/dd19-bot/tree/d1924f37a4c87c4e5eb3229825ca2dc042664015). We reviewed its MIT-licensed `bot/plugins/auto_chat.py` (cheap prefilter, cooldown, per-sender followup, conservative admission) and `bot/core/persona_evo.py` (pending proposals, approval, separate patches and rollback). No third-party package or executable is installed. No third-party source or persona text is copied.

The existing recursive persona summarizer (`src/qq-self-persona.js`) remains an evidence producer. Its raw generated prose must not be passed directly to the review engine as a trusted system instruction. Existing group/member memory remains the provenance source; the new engine manages admission and review, not independent factual truth or a second bot implementation.

## Attention

`src/domain/cognition/attention.js` is a pure deterministic gate. It makes no model/network calls. A host must first enforce account, group, current real mention and reply-policy checks. `eligible=false` denies even a mandatory input; a policy-approved explicit request bypasses interest credit. Optional participation requires topic, question, address or a recent delivered same-member reply. Unrelated long chatter cannot create permission to interrupt.

Interest credit decays over ten minutes. Optional admission obeys the existing cooldown, a three-per-ten-minute room budget and repeated-text suppression. Followups last at most two minutes and never bypass cooldown or room limits. Failed/uncertain sends do not create a followup window. The host calls the gate after deduplication, persists its returned state with the queue, and calls `attentionReply` only on a confirmed delivery. State stores bounded counters, timestamps and fingerprints, not raw chat. Restore validates bounds. Profile integration opts in with `attention.enabled=true`; omission/false preserves previous admission behavior.

## Review and recursive feedback

`src/domain/cognition/persona-review.js` consumes host-validated proposals with a fixed style theme, group, member, persona, source core version, expiry and evidence identifiers. Eligibility requires at least three independent sessions across two days. The host must derive these counts from actual validated human evidence, not model-provided counts. Rejected/withdrawn/conflicting evidence cannot be offered as a valid candidate. Bot output, retrieved memories and previous overlays must not reinforce themselves as human evidence.

The lifecycle is pending �� approved/rejected; approved �� rolled-back or superseded. Every operator decision uses a revision compare-and-swap and a bounded audit ledger. Approval allows at most two active patches per group/member/persona. Changed core version, expired/withdrawn evidence or a changed evidence fingerprint immediately makes an old patch inert. Rejection and rollback are not automatically undone.

An applied overlay contains only operator-owned wording from `styleThemes`. Free-form human/model text cannot become an executable prompt patch. Core identity, model choice, permission rules and mathematical correctness are outside this style overlay. `selectPersonaRequest` selects the actual routed persona's memory/overlay and removes the other bundles before provider invocation. Personae, groups, members and private peers remain distinct.

The portable repository provides these reusable modules, tests, and an opt-in attention adapter for its existing teaching profile. Local memory/provider/review-API adapters and private runtime files are not part of the public export. This is not an assertion that every legacy caller is automatically governed by the new ledger: a host must wire its validated candidate producer and approval boundary explicitly.

## Local deployment adapter

The existing local group memory now generates separate candidates for both configured personae. `personaEvolution.enabled=true` enables `persona-review.json` beside the existing memory, without rewriting core persona files or approved historical evidence on startup. The private deployment enables both switches through its existing private profile, never by replacing that profile with a public default.

Authenticated loopback POST `/api/maintenance/persona-review` accepts `groupId`, `persona`, `action` (`list`, `approve`, `reject`, `rollback`), and for decisions `id` and `expectedRevision`. Unknown fields are rejected. Group chat commands do not acquire operator rights. List responses contain fixed proposal wording and provenance identifiers; keep them private. Diagnostics expose only enabled state, counts and revision. An approved proposal is applied only to its matching member/persona in the same group. No current candidate is automatically approved by installation.

## Verification

`node --test test/cognition-review.test.js` exercises pure admission, bounded state, review, isolation, evidence revocation and rollback. The local `profiles/set-theory/cognition-integration.test.mjs` additionally covers durable memory, actual provider selection with injected clients, protected-group mention rules and authenticated review API behavior. These are offline fixtures, not claims of real model or QQ delivery acceptance. Run the repository verification command and compare any existing platform-specific failures. Reload only an idle/checkpointed Hub; retain QQ, knowledge, private settings and session state. Never send synthetic group messages to validate this feature.
