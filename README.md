# QQ Assistant Core

[简体中文](README_CN.md) · [Upstream project](https://github.com/gl813788-byte/codex-qq-bot)

A local QQ research assistant with private textbook retrieval, mathematical discussion, autonomous Bilibili exploration, account-scoped platform access and bounded concurrent question workers.

This repository is a GitHub fork of **gl813788-byte/codex-qq-bot**. Its generic Hub, OneBot transport infrastructure and Codex app-server client come from that project. The research-assistant profile and the integrations described below are additions maintained here. Read [UPSTREAM.md](UPSTREAM.md), [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) and [LICENSING.md](LICENSING.md) before redistributing it. The upstream snapshot has no declared license; this fork does not relicense it or claim that it is an independently authored implementation.

## Capabilities

| Area | Included implementation |
| --- | --- |
| Knowledge | Recursive PDF ingestion; content hashes and deduplication; native text and resumable OCR; chapter/definition/theorem-aware bilingual retrieval; original page images |
| QQ | Receive allowlisted group messages, answer mentions, selectively join discussions, read quoted messages and group files, import selected PDF textbooks |
| Answers | gpt-6.1-sol with high reasoning; plain QQ text; mathematics and casual conversation use different persona instructions |
| Media and web | Image understanding, public web search/read, image search and delivery, scoped group-resource reads |
| Bilibili | QR login and encrypted session storage; search, recommendation feed, related videos, subtitles, media download, sampled frames, local speech recognition, multi-step interest exploration, optional likes/comments and QQ sharing |
| Academic browsing | arXiv and Crossref journal discovery, public HTML/PDF reading, scope labels, evidence-checked curation and deduplicated QQ recommendations |
| Accounts | Operator-configured account binding and Windows DPAPI vault; Bilibili is enabled when configured; the Zhihu official API adapter is present but disabled in the production account panel |
| Scheduling | Three question workers by default, at most two per group and one optional/background task; mentions have priority; reading memory and delivery records are persisted per group |

The application daily reasoning cap is null (no application-imposed daily cap). Your account's actual Codex usage and rate limits still apply. There is no automatic API-key billing fallback or model downgrade.

## Quick start

Use Node.js 22 or newer, Python 3.11 or newer, Git, a locally signed-in Codex CLI and a separately installed NapCat/OneBot service. Windows is required for the included DPAPI account vault and Windows OCR. The text/PDF core and optional Tesseract importer can run elsewhere; replacing the platform vault on other operating systems is not implemented.

```sh
git clone https://github.com/EgoFakeFantasy/qq-assistant-core.git
cd qq-assistant-core
npm ci
python -m pip install -r requirements.txt
npm run init -- --bot-id 2000000002 --group-id 1000000001,1000000002 --bilibili-uid 4000000004
```

The numbers above are synthetic examples. Supply your own account and group identifiers. On Windows, add --codex-path with the absolute path to codex.exe if a native executable is not on PATH. Add --python-path when using a virtual environment.

Initialization generates private/live-config.json, private/profile.json, an empty private knowledge store and private NapCat configuration templates. It refuses to overwrite an existing private configuration. Copy the generated NapCat settings into your separately installed NapCat configuration directory; retain loopback binding and matching OneBot/webhook tokens. Log in to the configured QQ account.

```sh
python tools/import_library.py --source "/path/to/your/books" --output private/knowledge --ocr auto
npm run start:live
npm run health
```

The importer never rewrites the source PDFs. It accounts for unsupported files and unfinished OCR in private/knowledge/import-report.json and returns a nonzero status when the import is incomplete. Use --language zh-Hans-CN with Windows OCR or --language chi_sim+eng with an appropriately configured Tesseract installation. Mathematical OCR can be inaccurate; original page images remain available to the model.

npm start runs a finite offline demonstration with synthetic data. It does not log in, spend model quota or send messages.

## Handwritten mathematical pages

The original visual-semantic indexing workflow is also included as a portable tool. After PDF ingestion, use a bookId from the private corpus manifest and explicitly select the PDF pages:

```sh
node tools/index-visual-pages.mjs --book-id BOOK_SHA256 --pages 1-12,18
```

It renders original pages, uses gpt-6.1-sol/high through the same Codex account, indexes three pages per request, records uncertain symbols, and resumes completed batches. It preserves unselected index rows and does not merge malformed or misordered output. This command consumes real model quota when invoked; CI uses an injected synthetic model. Use --all only when you intend to index the entire selected book. Restart an idle Hub after changing its base index. Source images, summaries and batch caches remain private.

## Bilibili login and autonomous exploration

On Windows, run npm run accounts and separately run npm run accounts:token to display the local panel key. Enter that key in the panel at http://127.0.0.1:3791 and scan with the configured Bilibili account. Account mismatches are rejected. The key display command is only for the local operator and must not be exposed as a QQ tool.

Add videoRuntime paths for FFmpeg, ffprobe, whisper-cli and a compatible local Whisper model to private/live-config.json. See config/assistant.example.json. In private/profile.json, explicitly enable autonomousBilibili.enabled. Its targetGroupId must be the primary allowlisted group. likesEnabled and commentsEnabled are false by default. Enable them separately in your own deployment. Exploration cadence, videos per cycle, social-action and share limits are configurable.

The explorer combines interests, recommendations, searches and related videos. It downloads the first video part, decodes its audio and supplies the model with timed text and 12 sampled frames. It can inspect additional timestamps. If platform subtitles do not sufficiently cover speech, local Whisper is used. The model receives audio-derived text, not native audio. This is bounded sampling, not a claim that every frame or every multipart video has been viewed.

Comments and shares have separate budgets, account/scope checks, persisted receipts and duplicate protection. Uncertain sends are not blindly repeated. QQ questions can interrupt background exploration. These controls do not guarantee that an external platform will keep an account logged in.

The Zhihu read-only official API adapter remains disabled by default. There is no claim of a verified Zhihu browser-login flow, arbitrary multi-platform browser automation or universal account support.

See [local operations](docs/ASSISTANT_OPERATIONS.md) for optional Windows supervision and protected QQ password recovery.

## Autonomous academic reading

Enable autonomousScholar.enabled in private/profile.json and use the primary targetGroupId. Sources rotate across arXiv categories and Crossref journal records. Public HTML/PDF is preferred; abstract-only recommendations are labelled. Support quotes must match actual reading blocks, and DOI/title deduplication covers preprint and journal versions. Both interests share one preemptible background slot and the same Codex allowance. See [autonomy configuration](docs/AUTONOMY.md).

## Layout

- profiles/set-theory/: the research assistant, retrieval, persona, workers, resource tools, account vault and Bilibili explorer.
- src/app/teaching-hub.js: authenticated local Hub and per-group composition.
- tools/import_library.py: portable, private PDF/OCR ingestion.
- deployment/: Windows OCR and bounded QQ login/supervision utilities.
- scripts/: private configuration initialization, operator tools and verification.
- docs/upstream/: preserved original upstream entry documentation. Other legacy upstream files remain for provenance; the research assistant entry points are the ones documented here.

Never commit private/, textbook files, extracted text indexes, login state, cookies, keys, QR images, chat records or local test logs. Public files contain source code, synthetic fixtures and configuration examples only.

## Verification

```sh
npm run verify
npm run verify:knowledge
npm run audit:public
```

CI runs the core and synthetic PDF tests on Windows and Linux. This checks implementation and isolation behavior; it does not certify every mathematical answer or guarantee permanent QQ/Bilibili login.
