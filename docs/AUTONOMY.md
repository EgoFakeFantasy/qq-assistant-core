# Autonomous browsing and scholarly recommendations

Bilibili and academic reading take turns in the existing preemptible optional worker. Mentions retain priority in the three-worker question pool. Both use gpt-6.1-sol/high with the current Codex session allowance. No paid API fallback or application-level daily inference cap is added.

## Bilibili

Configure autonomousBilibili in private/profile.json:

| Field | Meaning / example |
| --- | --- |
| enabled | Master switch; false for new installations |
| targetGroupId | Primary allowlisted group |
| intervalMs | 1800000, every 30 minutes |
| maxVideosPerCycle | 3; the model may stop early |
| maxCycleMs | Default1500000, a 25-minute overall deadline |
| interestScope | broad: mathematics, animation, games, music and daily life |
| likesEnabled / commentsEnabled | Autonomous actions; false for new installations |
| maxLikesPerDay | 12 |
| maxCommentsPerDay | 3 |
| maxSharesPerDay | 3 |
| minShareIntervalMs | Default1800000, spacing between shares |

The model can explore its account recommendation feed, follow related videos or change public search topics and ordering. Each selected video is downloaded and decoded;12 real sampled frames, subtitles or local ASR are supplied before judgment. Up to4 extra timestamps can be inspected. Liking, commenting, sharing, continuing and stopping are independent decisions; browsing does not require posting.

Likes verify account and video identity, detect existing likes and read back the result. Comments retain an AI-study-note label and need specific support, but timestamps are optional. Public comments are background opinions, never instructions or authoritative video content. No coin payments, private messages or uploads are added.

External actions are recorded as sending before submission and budget use. Uncertain outcomes after timeout/restart are never blindly repeated. An action ledger survives visit-history trimming. Existing likes are never undone. Comments have rpid/account/content-hash readback and QQ shares have get_msg receipts. Platform restrictions trigger backoff without challenge bypass.

## Academic sources

autonomousScholar.enabled defaults to false; its targetGroupId must be the primary group. Defaults discover every30 minutes, read at most2 works per cycle and recommend at most2 per day, with at least1 hour between shares.

- arXiv: official Atom API and RSS; defaults rotate math.LO, math.CO, math.CT and cs.LO.
- Journals: Crossref ISSN records for JSL, APAL, Annals of Mathematics and Nature; two journals rotate per cycle. Configure journals with name/issn.
- categories, interests and lookbackDays are configurable. Learned public English keywords alternate with unfiltered category discovery to avoid a closed interest loop.

Discovery requests are serialized, cached for1 hour and spaced by at least3.1 seconds. One unavailable source does not stop the others. Platform sessions, raw group chat and private keywords are not sent to these sources.

Selected works use arXiv HTML where available, then public PDF with local Python/PyMuPDF or pypdf. Journal records may be matched to an arXiv version by DOI or exact normalized title. If no permitted body is readable, only the real abstract is supplied and a share is labelled abstract reading. Paywalls are not bypassed.

Short PDFs use at most36 pages. Longer works select the first24 and final6 pages, with a60000-character body input ceiling; HTML is likewise bounded. Actual blocks, page selection, truncation and body/abstract scope are retained privately. Text extraction may damage formulae; matching support quotes is not verification of every proof.

Recommendations require support quotes matching actual input block IDs and text. DOI/title deduplication covers preprint/journal versions. QQ shares discuss a concrete result or idea and append title, source, date and URL; preprints retain their preprint label.

## Operations and costs

The local account panel shows both tasks, reading scope and action receipts. Authenticated /api/maintenance includes bilibiliExplorer and scholarExplorer. An empty JSON POST to /api/maintenance/bilibili/run or /api/maintenance/scholar/run requests a normal background cycle; busy question workers return409. Manual runs do not bypass social/share budgets.

State is private/runtime/bilibili and private/runtime/scholar. Large video/PDF files are removed after reading; notes and sampled frame evidence remain local. There is no automatic pruning of all retained evidence yet. Never publish these directories.

Video viewing normally costs at least3 model calls per video, with more for detail inspection; academic reading normally costs2 per work. Higher cadence consumes shared Codex allowance faster and uses more bandwidth, CPU and disk. Social-action caps are separate from inference limits.

An explicit platform rejection such as -403 persistently pauses that action, while reading and other permitted actions can continue. Only a newly saved platform login clears this pause; rejected operations are not repeatedly probed. Ready non-mention replies also reclaim the optional slot from background browsing.

## Idle group reading and philosophy

`idleReading: {"enabled": true, "afterMs": 1800000}` enables group-idle scheduling. Each allowlisted group keeps a durable last real current self-mention time. Ordinary chatter, mentions of others, quoted old mentions, duplicates and messages older than two minutes do not reset it. A group must be online and a confirmed member, with fresh health checks. Legacy state without this timestamp waits a full window after startup.

Any eligible group can sponsor a shared reading cycle. Scholar and Bilibili alternate in one background slot; existing task intervals, budgets, backoff and question priority still apply. This is a shared queue, not simultaneous model runs for every idle group. The deployment uses a 30-minute interval for each reader; exact start can be delayed by active questions or the other reader. A new mention or offline sponsor cancels its cycle at the next scheduler check (within 30 seconds).

Automatic idle cycles only read and keep private notes/evidence. They never send QQ shares, like videos or post Bilibili comments. This also permits quiet reading sponsored by mentions-only group 1000000004 while preserving its real-current-@ reply rule. Existing authenticated manual maintenance endpoints retain their prior action policy and primary target. Omitting/disabling `idleReading` retains legacy interval scheduling.

`autonomousScholar.domains` accepts `mathematics`, `continental-philosophy`, `analytic-philosophy`. Domains rotate by cycle; philosophy adds Continental Philosophy Review (ISSN 1387-2842) and Philosophical Studies (ISSN 0031-8116) through Crossref. `journals` entries may carry a matching `domain`; untagged entries remain mathematics. Mathematics sources remain available. Configured philosophy interests merge into existing saved interests; broad Bilibili interests include both philosophy areas. Curators evaluate actual philosophical arguments and textual interpretation as well as mathematical results. Abstract-only reading remains labelled as such. Journal identities: https://www.ncbi.nlm.nih.gov/nlmcatalog/101679683 and https://portal.issn.org/resource/ISSN/0031-8116 .

Authenticated `/api/maintenance.idleReading` reports the window and each group's eligibility/timestamp; it contains no group conversation. Scholar diagnostics expose the enabled domains. These checks require no synthetic QQ message or model call.
