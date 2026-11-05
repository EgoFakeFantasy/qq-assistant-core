# Issue fixes and QQ private replies

Private messages are opt-in in the operator-owned profile:
```json
{"privateMessages":{"enabled":true,"maxConversations":64},"quotaTimeZone":"Asia/Shanghai"}
```

Only authenticated OneBot friend messages for the configured bot are accepted. The service checks the real login account, online status and friend list. Stranger and temporary group sessions, self echoes and robots do not start a question. No automatic friend acceptance or proactive private outreach is added.

Each contact has a typed internal scope private:<userId>, a separate queue, turn workspace, context, durable state and candidate-only memory under private/runtime/private-conversations/<userId>. Group IDs remain unchanged. The shared worker pool counts private questions toward its existing concurrency budget. Queues resume after restart; uncertain sends are not retried. maxConversations limits stored contacts, including contacts not currently loaded. Raising it or archiving an idle private directory is an operator action; no conversations are silently evicted.

Private text replies use Axu / gpt-6.1-sol/high. Naming Hui or quoting an old mention does not switch providers in a private conversation. Existing group and Hui activation rules remain unchanged. Private replies can retrieve the configured base textbook corpus, but have no group file library, other contacts' histories, group chat memory or platform-account tools. Incoming private images/files are marked unread; this release does not implement private file ingestion or incoming image understanding.

Before sending, the private adapter reads the actual original message, checks its peer and rechecks friendship. It uses send_private_msg or send_private_forward_msg and attempts get_msg / forward-content readback. A returned message ID and verified=true are distinct. Failure to read back does not trigger a second send.

The six fixes:

1. Explicit definitionIntent now affects base-corpus ranking, including keyword-only tool searches.
2. An absent Kanamori / Higher Infinite yields missingRequestedBooks while searching other imported sources by topic. Exact missing-book page commands never substitute another book's page. Fallback hits are not evidence of reading the absent book.
3. Long PDFs still have a bounded first24/final6 sampling strategy, with explicit readRanges, missingRanges and truncatedPages after the 60000-character prompt budget. Partial readings are labelled, cannot cite missing pages and require a provided-excerpts claim scope. A48-page paper reports pages25–42 as missing. Quote matching does not verify whole proofs.
4. Readers try public journal HTML and available PDF alternatives. Crossref text-mining PDF links are tried first among journal PDF links, with at most two HTML and three PDF attempts. Access checks and unavailable bodies lead to honest abstract-only scope; no paywall/authentication bypass is added.
5. quotaTimeZone defaults to Asia/Shanghai. A runtime-level value overrides the profile; per-explorer overrides are optional. Question, Bilibili and scholar daily limits share the same calendar function. Invalid zones fail startup. dailyModelCalls=null remains unlimited at the application layer.
6. Hub, visual index and OCR share a PID-lock helper. Dead legacy/JSON owners can be reclaimed; live/EPERM owners and invalid or replaced files are preserved. PID reuse is conservatively treated as live. These are local filesystem locks, not distributed leases.

Run npm run verify, npm run verify:knowledge and npm run audit:public. Focused regression suites are issues-regression.test.mjs and private-replies.test.mjs. Tests use synthetic data and injected transports/models; they do not constitute acceptance of a real QQ private reply. After an idle Hub reload, acceptance requires a real human private message, fresh inference and delivery readback. Keep all runtime state and real conversation material private.
