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

autonomousScholar.enabled defaults to false; its targetGroupId must be the primary group. Defaults discover every3 hours, read at most2 works per cycle and recommend at most2 per day, with at least1 hour between shares.

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
