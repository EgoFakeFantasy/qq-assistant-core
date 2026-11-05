# 完整复用与重新部署

本仓库保存已退役部署的可复用实现。账号、群号均为虚构示例。凭据、聊天、成员档案、教材、索引、运行状态和维护日志不发布。克隆不会恢复原部署或计划任务。

## 干净安装

需要 Node.js 24+、Python 3.12 和已授权的 Codex CLI。可选回人格需要合法安装并登录的 Antigravity CLI；第三方程序和登录状态不分发。

    git clone https://github.com/EgoFakeFantasy/qq-assistant-core.git
    cd qq-assistant-core
    npm ci --ignore-scripts --no-audit --no-fund
    python -m pip install -r requirements.txt
    npm run verify
    npm run verify:knowledge
    npm run audit:public
    npm run init -- --bot-id 2888888888 --group-id 1888888888,1888888889

替换为自己的账号和允许群。初始化创建新的 private/live-config.json、private/profile.json、空知识目录和随机密钥，拒绝覆盖已有配置。config/research.example.json 展示全部可选功能和预算，自主功能默认关闭。

## 功能地图

| 功能 | 入口与说明 |
| --- | --- |
| PDF、OCR、原页、群文件、网页和学术检索 | profiles/set-theory/knowledge*.mjs、resource-session.mjs；自行提供教材 |
| 阿序/回、话题路由与 CLI | persona-router.mjs、humanities-routing.mjs、antigravity-cli.mjs、prompts/；SECONDARY_PERSONA*.md；网页代理已移除 |
| 群聊/私信隔离 | live-onebot.mjs、live-private-onebot.mjs、group-reply-policy.mjs |
| 长期及社交记忆 | long-term-memory.mjs、social-memory.mjs、memory-anchor-semantics.mjs；LONG_TERM_MEMORY*.md、SOCIAL_MEMORY*.md |
| 认知、注意和学习 | src/domain/、learning-memory.mjs、persona-load.mjs；COGNITION*.md、PERSONA_LEARNING*.md；候选不会自动批准 |
| 自主阅读和平台 | background-scheduler.mjs、Bilibili/学术模块、账户保险库；AUTONOMY*.md |
| 官方 QQ SDK | src/channels/qq/official-*.js、official-runtime.mjs；QQ_OFFICIAL*.md |
| LLBot | llbot-runtime.mjs、prepare-llbot.mjs、deployment/；LLBOT*.md |
| Windows 运维 | deployment/ 的 DPAPI、互斥、退避、登录判定、OCR 和监督；仅明确安装才创建任务 |

## 接入与验证

OneBot：自行安装兼容桥接器，应用初始化生成的网络配置，保留 loopback 与双向鉴权。手动启动 npm run start:live，只读检查 npm run health。见 ASSISTANT_OPERATIONS*.md。

官方通道准备：

    node scripts/prepare-qq-official.mjs --source private/live-config.json --destination private/qq-official-config.json
    node scripts/check-qq-official.mjs private/qq-official-config.json

创建应用、配置 AppID，经本机 QQBOT_APP_SECRET 提供密钥并绑定真实群/成员 OpenID。官方身份与数字 QQ 身份不同，不按昵称合并旧记忆；完成平台授权才启动。

LLBot：校验官方包并解压到 private/llbot/vendor/v8.3.2，运行 node scripts/prepare-llbot.mjs . private/llbot/vendor/v8.3.2。准备不启动或转发。启动必须有合法项目 Auth Token，并显式提供 -QqPath。2026-11-03 授权站停止新用户注册，无现成合法 Token 的新部署目前无法完成；不得绕过授权。

离线测试不调用真实模型或发群消息。真实接入仍须核验账号、在线、群关系及媒体能力。官方发送接受不等于 get_msg 回读；不确定写入不得自动重试。新运营者须自行配置账户与资料，明确启用可选外部动作，保留人格候选和人工审核边界。
