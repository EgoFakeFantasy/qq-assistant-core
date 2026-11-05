# Autonomous persona reading and long-term learning

This is a local deployment feature. Preserve private/live-config.json profilePath. Only private autonomousLearning.enabled=true enables separate Hui workers; source defaults do not enable Hui or grant public writes.

## Scheduling and budgets

Axu and Hui each have a video and scholarly-article job, rotating through one low-priority background slot. The current private deployment uses the per-persona majority load gate described below and a five-minute video interval, up to six videos per cycle; articles run every thirty minutes, up to two. Fresh online/membership checks, question priority and cancellation remain mandatory. Quota/platform backoff may prevent reaching a target.

Count the first-part content duration of successfully analysed media per configured quotaTimeZone calendar day (the accepted private profile currently uses Asia/Shanghai): Axu at most43200 seconds (12hours); Hui targets14400 seconds (4hours), then continues only while at least one of the latest five videos is liked, at most28800 seconds (8hours). Reserve actual metadata duration before review, settle after durable notes, release failed/interrupted reviews; the next exclusive Hub owner releases abandoned reservations. Sampled frames and subtitles/ASR are not exhaustive viewing or native audio listening. Articles do not use video time.

Axu remains gpt-6.1-sol/high on the existing Codex subscription. Hui background work pins gemini-3.8-flash-high on the existing Antigravity subscription, checks Flash quota and never falls back to Argon, Codex or API billing. Conversation routing remains unchanged.

## Memory and attention

runtime/persona-learning/axu.sqlite and hui.sqlite retain independent source-linked notes, actual reading scope, public transcripts/article excerpts or frame timestamps, three-way self-feedback and its reason. Every completed review enters memory even without sharing, liking or commenting. Deduplicate legacy completed Axu notes and account their recorded video duration on the original quota date without modifying old files, inventing retrospective likes or attributing them to Hui; historic neutral notes do not train attention.

Article quotations still require exact matches against actual read blocks. A first validation failure allows one correction using host-extracted source quotations; a second failure ends the review without committing invalid evidence.

New model feedback is like/neutral/dislike with a concrete reason. Unique evidence gives its public topics +1/0/-1. Subsequent search combines average feedback and exploration bonuses, with weighted attention on80% of steps and fixed exploration on20%. Search candidates precede mixed recommendations. Negative topics are not rewarded through suggested queries. publicQuery validation continues to constrain outbound topics; source text cannot change permissions or configuration. Video/article and persona topic weights are separate.

Before chat inference, retrieve bounded relevant public notes for each persona and inject only the routed persona's publicLearningMemory. Learning may influence interests, examples and associations, without turning source claims into proven facts or human preferences, changing core identity or overriding approved expression rules. Full evidence remains in local SQLite; model prompts receive bounded summaries.

## Permissions and operation

Automatic jobs remain read-only; no new platform or group writes. Group1000000004 still requires a fresh real current@. Existing explicit Axu/secondary opt-out, ordinary-message and private-message routing remains. Gemini web is closed. Preserve existing chat archives, social memory, affinity and textbooks.

Authenticated idleReading.jobs diagnostics expose all four tasks, persona/model, learning counts and daily video budgets. Deploy only an idle Hub with deployment/deploy-idle-hub.ps1, preserving QQ. Roll back through the deployment backup and retain new learning databases.

## 2026-10-29 Per-persona majority-group load gate

The private idleReading.loadPolicy={mode:"persona-majority",highMentionsPerMinute:5} replaces the former five-minute no-mention gate. Count real current self-mentions over a rolling60-second window, separately for Axu/Hui using the actual reply route. Exclude duplicates, quoted/old mentions, DMs, unmentioned topics and bots. Persist bounded timestamps per group without new chat content; restart retains the current window and old states remain compatible.

At least three of four configured groups must each reach five mentions/minute to suspend that persona. One or two busy groups and calls to the other persona do not meet this gate. The threshold is configurable from5 to10. Counts expire naturally after60 seconds. Recheck every5 seconds; one mention no longer revokes eligibility. Yield for actual majority load, offline/stale health or required foreground capacity. Interrupted work may retry eligibility after5 seconds instead of waiting another five minutes; platform backoff, daily duration and ordinary cycle intervals remain.

Online/membership checks, capacity, foreground priority and read-only operation remain. No live group mention tests or question-model tests are sent. Authenticated idleReading.loadPolicy.personas exposes counts and majority decisions. idleMs remains for compatibility and does not gate eligibility when trigger=persona-majority.

Under this gate, reading uses one spare physical worker without consuming the foreground optional allowance. Foreground optional, global and per-group concurrency limits remain unchanged. Reclaim the single background worker only when it helps queued human work.
