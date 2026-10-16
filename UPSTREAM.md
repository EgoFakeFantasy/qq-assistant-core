# Source and provenance

This repository is a GitHub fork of [gl813788-byte/codex-qq-bot](https://github.com/gl813788-byte/codex-qq-bot).

The implementation was based on commit [19b58499290fc1f36842222be90b80630c3443fe](https://github.com/gl813788-byte/codex-qq-bot/tree/19b58499290fc1f36842222be90b80630c3443fe). Original commits and author identities are retained. The original top-level documentation is preserved in docs/upstream/.

Upstream provides the generic QQ/OneBot infrastructure, local Hub HTTP and security utilities, persistence helpers and Codex app-server turn runner. The set-theory profile, private retrieval, structured resource research, autonomous Bilibili workflows, scoped platform accounts and Windows operational tooling were developed on top of that foundation.

Small changes to inherited runtime files add a session-preparation hook, additional app-server arguments, raw webhook signature verification and native Windows path/file-sync compatibility. They are visible in the commit diff relative to the upstream base.

No textbook text, private knowledge index, account credential, login cache, QR code, conversation record or machine-specific configuration is part of the added public core.

原始项目及作者来源保留如上；本仓库明确区分继承基础设施与新增助理模块，不将原作者贡献据为己有。
