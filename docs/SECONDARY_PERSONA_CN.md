# Antigravity 备用人格

实施状态：实验中，本机正式机器人尚未启用。单元覆盖及一条真实教材问答已通过，完整多轮检索和真实 QQ 发送验收仍待完成。

同一个 QQ 账号、NapCat 登录、OneBot webhook 和发送通道可以使用两个明确区分的模型侧面。主侧面仍固定 gpt-6.1-sol/high。新增侧面默认名为“回”，活泼、好奇，数学假设、推导和引用核验要求保持一致。

## 何时出现

- Codex 额度接口确认可用额度为零，或者实际推理返回明确的 usage_limit_reached/insufficient_quota 时，群问答可转交 Antigravity。
- Codex 还有额度时，只响应当前消息明确的召唤，例如“请 Gemini 人格出来回答”“@机器人 回，请解释共尾度”或 /gemini。讨论模型名称、否定召唤、历史消息和被引用的指令不构成召唤。
- 普通 429、超时、鉴权失败和无效输出不冒充额度耗尽。未知额度先保持主侧面，不按零处理。
- 一条消息由一个侧面负责，不重复发送两份答案；不同成员的问题可以使用现有工作位并发，同一成员仍按顺序处理。
- 这一路由作用于群问答和该题的资料工具循环。B站、学术浏览的独立后台策展器仍保留原有 Codex 模型配置。

每个群第一次出现 Gemini 时，后台附加醒目的人格说明。因额度耗尽切换时明确说明原因；主动点名时明确说这不表示 Codex 耗尽。后续消息仍有姓名与真实模型标签。首次说明在成功发送后按群持久保存，推理并发不会造成重复首次声明。

## 配置

在私有 profile.json 中显式启用：

~~~json
"secondaryPersona": {
  "enabled": true,
  "name": "回",
  "argonMinRemaining": 0.2
}
~~~

在私有 live-config.json 中配置官方 CLI：

~~~json
"antigravity": {
  "executable": "C:/path/to/agy.exe",
  "isolatedHome": "private/antigravity-home"
}
~~~

通过 Google 官方安装说明取得 Antigravity CLI。它使用系统安全钥匙串中的现有 Antigravity 登录；无需复制桌面令牌，不设置 Gemini API Key，不操作正在进行的桌面对话。若官方 CLI 没有可复用的登录，先完成其正常登录流程。

后台通过 agy -p /usage --output-format json 读取 command.data.groups.buckets.remaining_fraction；Codex 使用 account/rateLimits/read。查询不启动推理，结果有60秒缓存与同进程合并读取。

Argon 剩余比例达到配置阈值且为正时优先 gemini-4-argon-high；否则使用仍有额度的 gemini-3.8-flash-high。Flash 已耗尽而 Argon 仍有额度时使用 Argon。零、未知、disabled 明确区分；未知 Argon 权限不会凭模型目录推断可用。所有备用模型使用 high。两边都耗尽或无法确认备用额度时停止该次调用，不购买额外额度。

## 资料与执行边界

两种侧面共用同一知识库、原页定位、群文件、公开网页、B站读取和图片资源网关。Gemini 输出结构化 knowledgeRequests，后台通过既有受限工具执行，再把结果交回模型；不是给模型开放任意本机命令或整个教材目录。引文、网页来源、文件和图片范围仍由原有代码校验。

官方 CLI 每题使用独立 HOME/USERPROFILE、显式登记的题目工作区和仅限该目录的只读规则，以固定模型和 JSON schema 运行。禁止原生命令、非沙箱命令、文件写入、浏览器操作和第三方原生 MCP；插件能力通过现有后端网关提供。关闭个人 AI credits 回退，不继承 API Key。只可读取本题工作区已准备的原页图片。原生 CLI 的拒绝、超时和失败不能当作成功答案。

额度耗尽后的模型切换最多一次，并计入原来的每题4/6次调用边界。QQ 写入仍由唯一的原发送通道执行，保留群范围、格式过滤、可爱表情、长回复卡片、持久回执和不确定发送不重试的规则。巡检不调用两种问答模型。

已验证的 CLI 1.4 中，allowNonWorkspaceAccess 和 useG1Credits 使用布尔值 false；CLI 稀疏保存时可能省略这两个默认值。每次命令均核对私有日志，配置加载失败时，即使返回 SUCCESS 也拒绝结果。

## QQ 登录恢复

模型路由不会启动第二套 NapCat 会话。Windows 守护器保留加密密码恢复、互斥、退避和验证暂停。旧面板密钥失效时，管理认证会自动读取 NapCat 本机配置中的新密钥，无需用户提供；它与腾讯人机验证码不同。此功能不会绕过腾讯验证，也不能保证服务端会话永不失效。本机已配置的守护器核实在线后会清除旧验证暂停。

## 来源

- [Antigravity headless mode](https://antigravity.google/docs/cli/headless/)
- [Antigravity CLI 安装与登录](https://www.antigravity.google/docs/cli/install/)
- [Antigravity 权限与隔离](https://www.antigravity.google/docs/permissions?tab=cli)
- [Codex app-server 额度接口](https://learn.chatgpt.com/docs/app-server)

## Gemini 网页自动化已退役（2026-10-22）

部署者已撤销网页反代计划。Edge 扩展、自动工作页脚本、网页桥客户端与网页验收脚本已删除。旧扩展的定时器每30秒检查并重建专用 Gemini 页面，即使生产网页路由关闭也可能继续开页。已加载的扩展须在 Edge 中移除一次；删除源码不会卸载内存中的后台工作线程。巡检不得恢复、重新加载或启用此路径。已验收的 Antigravity CLI、私有 profilePath、群回复规则和人文话题路由继续保留。

## 本机受限验收

正式开关 secondaryPersona.enabled 保持 false 时，可设置一次限时 canary：groupId、prefix 和 expiresAt（UTC 毫秒）。只有指定群的当前真实自 @、以指定口令开头、到期时间距当前不超过30分钟的消息，才进入 Gemini 验收。其他点名明确返回未启用；不会暗中由 GPT 代答。过期后的继续检索也失败关闭，不转交 GPT。普通问题继续使用原主模型，1000000004 的仅 @ 限制始终先于人格路由。

CLI 验收须完成真实教材 search/read/引文和人类群 @ 回复读回，才移除 canary 并正式启用。部署只重载空闲 Hub，不重启 QQ。已退役的网页扩展不属于此流程。

CLI 的工具权限拒绝必须立即终止本轮，返回 AGY_TOOL_PERMISSION_DENIED，不能把后续空 SUCCESS 当答案，也不能自动重试被拒绝的资料。2026-10-17 实测：CLI额度查询、文本生成、结构化教材检索成功；受限原页读取仍被CLI权限系统拒绝。该结果不是完整知识库或群聊验收，正式开关保持关闭。


## Windows CLI 本地读取修正（2026-10-17）

CLI 1.4.0 在本机 strict 预设下，加载精确 read_file 规则后仍会在 headless 模式软拒绝读取。合成对照实验中，保留完全相同的命令、写入、原生网页与 MCP deny 规则，只在有授权图片的轮次改用 request-review，读取成功；实际写入尝试仍被拒绝且未产生文件。无图和额度查询保持原 strict 配置。不使用危险跳过审批参数，不改变用户全局设置或浏览器站点权限。

Windows 权限路径去掉盘符并统一正斜杠。每轮只为实际图片建立逐文件 read_file 规则。原生工作区只有本轮图片的只读副本，CLI HOME 位于该工作区之外；workers-v4 指纹包含题目目录、原路径及内容散列，保留历史配置。新建项目显式绑定当前工作区。不能读取原题目录、其他轮次或任意本机文件。

单步权限错误、终态 denied_actions 和日志中的 soft-denying 都使本轮失败，不能将后续空 SUCCESS 当答案，也不能自动重试拒绝的资料。当前正式客户端真实合成图片测试正确识别 7142 和红色方块；这不是教材验收。43 项定向测试通过。真实教材 search/read/引文及人类群内 @ 回复和回读仍须通过，正式开关保持关闭。

真实 @ 另支持“请以回的身份回答”“用回的人格来解释”“请回解释一下”。普通“请回答”“请回复”“请回来回答”不作为姓名召唤；没有真实 @ 时这些单字姓名句式不触发，1000000004 的仅 @ 规则不变。网页站点拒绝不能通过扩展、其他浏览器接口或 CLI 网页工具绕行；独立 CLI 后端只使用自身已授权会话。本轮修改仅留本地。


## 本机人格文本（2026-10-17.3）

默认主侧面名为阿序。其风格正文位于 profiles/set-theory/prompts/primary-style.txt，来自部署者提供的文本；persona.mjs 单独加入阿序的身份句，并保留原有资料、权限与操作规则。prompts/hui-persona.txt 保存部署者提供的回人格。Gemini 路由先移除默认主身份句，再加入回人格；两者仍共享数学严谨、纯文本、温和表情、引用与工具边界。修改文件后仅在 Hub 空闲时重载 Hub，不重启 NapCat/QQ。人格文字更新不会启用尚未验收的 Gemini 后端。本机导出副本保存在部署目录 private/prompt-exports/2026-10-17.3；不发布。


CLI 1.4.0 会在持久化时省略默认值 request-review、allowNonWorkspaceAccess=false 与 useG1Credits=false。校验仅将这些缺省值补齐后比较整个设置对象；strict 轮次缺少 toolPermission 仍拒绝，always-proceed、额外权限或更宽读取范围仍拒绝。52 项定向测试覆盖相同图片范围的配置复用及这些拒绝路径。


更新：经部署者重新许可，完整人格提示词下的真实教材验收已完成：Gemini 4 Argon/high 先执行结构化检索，再通过两次原生 view_file 读取 Jech PDF 第40、41页（印刷第31、32页），引用匹配且正确证明通常定义下 cf(β+1)=1，并说明原书定义域为极限序数。最终 QQ 格式化文本无粗体标记。该验收仅覆盖这两页；尚未完成真实人类群内 @、发送和读回，正式开关仍关闭。本地报告保存在 private/hui-cli-knowledge-acceptance.json。


## 仅当前真实 @ 点名回的路由（2026-10-18，本机）

secondaryPersona.activationMode=mentioned-name 时，只有当前消息具有真实自 @ 且明确称呼人格姓名才进入 Gemini。姓名呼语、请以回的身份回答、请回解释与已 @ 的 /回 命令有效；引用、历史、普通回答/回复动词、Gemini/Argon别名、伪造 requestedPersona 均不能代替这两个条件。普通请求始终使用阿序，不因为 Codex 额度耗尽切换；Gemini 不可用时不由 GPT 冒充回。两侧共享原有知识库和资料工具。启用仍须真实知识库和人类群消息发送/读回验收，期间使用限时 canary。运行配置位于私有 profilePath；只重载已完成当前任务的 Hub，不重启 QQ。


已验收的本机部署通过私有 profilePath 启用 CLI 路径、清除限时验收入口，并保持 mentioned-name 模式。源码默认值仍对新部署保持关闭。网页路径的就绪与授权独立；CLI 验收通过不表示 Gemini 网站已获授权或已启用。


## 文学、历史、哲学按话题选回（2026-10-21，本机）

当前私有部署额外启用 secondaryPersona.routeHumanities=true，保留 enabled=true、activationMode=mentioned-name、canary=null 和原 profilePath。未设置该开关的部署保持旧行为，源码默认仍关闭。

只有原有群回复规则已经允许处理的当前消息，才按文学、历史、哲学的话题线索选择回。此开关不会把话题命中变成新的强制回复入口；1000000004 仍先检查当前真实自 @，其他群保留原自适应间隔、引用和他人 @ 限制。当前真实 @ 点名回仍可询问数学；明确点名阿序或拒绝回时按主侧面处理。

判定只读取当前消息，不继承历史、被引用消息或伪造 requestedPersona 中的话题。聊天／浏览／版本历史、代码块和数学证明任务不因一般“历史”字样误切换；明确的数学史或数学哲学讨论可以使用回。关键词未命中或语义不明确时保守留给阿序。此阶段只作用于群回复，好友私信仍保留阿序及原隔离边界。

按话题切换的首次说明如实标记为话题选择，不称作明确点名或 Codex 额度耗尽。回继续使用已验收的 Antigravity CLI、知识库和资料工具，网页路径保持关闭；Gemini 不可用时不由 GPT 冒充回。长期记忆的人格标签与该路由一致。

此更改只重载空闲 Hub，保留 QQ/NapCat 会话、知识库及私有配置的其他字段。回放使用合成群消息与模拟模型，不发送真实群测试消息。
