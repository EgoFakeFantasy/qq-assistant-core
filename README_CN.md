# QQ 助理核心

[English](README.md) · [原始项目](https://github.com/gl813788-byte/codex-qq-bot)

本地运行的 QQ 研究助理：私有教材检索、数学讨论、自主浏览 B 站、按账号隔离的平台接入，以及可并行的群问答。

本仓库通过 GitHub fork 保留 **gl813788-byte/codex-qq-bot** 的来源关系和提交历史。通用 Hub、OneBot 基础设施及 Codex app-server 客户端来自原项目；集合论助理及本文介绍的资料、浏览整合是本仓库新增内容。请阅读 [来源说明](UPSTREAM.md)、[致谢](ACKNOWLEDGEMENTS.md) 和 [授权现状](LICENSING.md)。原项目所用版本未声明许可证，本仓库不替原作者重新授权，也不将继承的实现宣称为独立原创。

## 包含的能力

| 部分 | 已包含的实现 |
| --- | --- |
| 知识库 | 递归导入 PDF、内容哈希和去重、文本层与可恢复 OCR、章节/定义/定理定位、中英文术语检索、原页图像读取 |
| QQ | 接收允许群内的消息，处理 @，选择性参与话题，读取引用、群文件，并导入选定的 PDF 教材 |
| 回答 | 默认 gpt-6.1-sol / high；数学讨论与日常聊天使用不同人格要求；QQ 输出会过滤粗体分隔符与固定防御性尾句 |
| 图片与网络 | 识图、公开网络搜索和网页读取、搜索并发送图片、按群隔离的资料读取 |
| B 站 | 扫码登录、加密保存会话、搜索/推荐流/关联视频/字幕、下载视频、抽帧、本地语音转写、按兴趣选择、可选评论及 QQ 分享 |
| 账号 | 操作者配置账号绑定，Windows DPAPI 加密存储；B 站可配置启用，知乎官方 API 适配器保留但生产登录面板未启用 |
| 调度 | 默认 3 个问答工作位，同群最多 2 个，非必要/后台工作最多 1 个；@ 问题优先，阅读记录和发送记录按群保存 |

应用层每日推理上限为 null，即不施加每日次数上限；仍受实际 Codex 账号额度和平台速率限制约束。不自动切换额外付费 API，也不自动降低模型。

## 从新环境启动

需要 Node.js 22+、Python 3.11+、Git、已在本机登录的 Codex CLI，以及单独安装的 NapCat/OneBot 服务。自带的 DPAPI 账号保险库和 Windows OCR 需要 Windows；文本/PDF 核心及可选 Tesseract 导入可在其他系统运行，其他系统的平台凭据保险库尚未实现。

```sh
git clone https://github.com/EgoFakeFantasy/qq-assistant-core.git
cd qq-assistant-core
npm ci
python -m pip install -r requirements.txt
npm run init -- --bot-id 2000000002 --group-id 1000000001,1000000002 --bilibili-uid 4000000004
```

以上号码均为合成示例，请填写自己的账号和群号。Windows 上如 PATH 中没有原生可执行文件，请加 --codex-path 指定 codex.exe 的绝对路径；使用 Python 虚拟环境时也可加 --python-path。

初始化生成 private/live-config.json、private/profile.json、空知识库和 private/napcat-config 下的 NapCat 配置模板；不会覆盖已有私有配置。将模板放入单独安装的 NapCat 配置目录，保持回环地址绑定、OneBot 和 webhook 令牌一致，然后登录指定 QQ 小号。

```sh
python tools/import_library.py --source "/path/to/your/books" --output private/knowledge --ocr auto
npm run start:live
npm run health
```

导入器不改原 PDF。未支持的文件、未完成的 OCR 都会记录到 private/knowledge/import-report.json；未完成导入会返回非零退出码。Windows OCR 可使用 --language zh-Hans-CN；安装相应语言包的 Tesseract 可使用 --language chi_sim+eng。数学 OCR 可能有误，因此保留模型读取原页图像的能力。

npm start 只运行使用合成资料的有限离线演示，不登录、不消耗模型额度、不发送群消息。

## 手写数学原页

原有的视觉语义索引流程也已改成通用工具。先导入 PDF，从私有 corpus manifest 中取得 bookId，显式指定 PDF 页序：

```sh
node tools/index-visual-pages.mjs --book-id BOOK_SHA256 --pages 1-12,18
```

工具会渲染原页，通过同一 Codex 账号调用 gpt-6.1-sol/high，每次处理 3 页，保留不清楚的符号记录，并可复用已完成批次。未选中的索引行会保留，格式或页序错误的输出不会合并。本机执行此命令会消耗真实模型额度；CI 使用模拟模型。确定要索引整本书时再使用 --all。更新基础索引后需在 Hub 空闲时重启以重读资料。原页、摘述和批次缓存均保持私有。

## B 站登录与自主浏览

Windows 下运行 npm run accounts，另开终端运行 npm run accounts:token 查看本机面板密钥，在 http://127.0.0.1:3791 中输入，再用配置的 B 站账号扫码。扫码账号不匹配时会拒绝保存。查看密钥的命令只供本机操作者使用，不能开放成群内工具。

在 private/live-config.json 的 videoRuntime 中配置 FFmpeg、ffprobe、whisper-cli 和兼容的本地 Whisper 模型，参考 config/assistant.example.json。随后在 private/profile.json 中显式开启 autonomousBilibili.enabled。分享目标必须是允许列表中的主群；公开评论默认关闭，需要显式开启 commentsEnabled。

浏览器逻辑结合兴趣、推荐流、搜索和关联视频寻找内容。它会下载视频首个分段、解码音频，并将带时间戳的文字与 12 张抽样画面交给模型；也支持追加查看其他时间点。平台字幕对语音覆盖不足时会运行本地 Whisper。模型接收的是音频转写文本，不是原生音频输入。这属于有界采样，不表示逐帧看完或看完多分段视频。

评论和分享有独立预算、账号及目标检查、持久回执和去重。发送状态不确定时不会盲目重发，群问答可打断后台浏览。这些控制不能保证外部平台的账号永不掉线。

知乎只读官方 API 适配器默认关闭；不宣称已经完成知乎浏览器登录、任意多平台浏览器自动操作，或支持所有平台账号。

可选的 Windows 守护和 QQ 加密密码恢复见[本机运维](docs/ASSISTANT_OPERATIONS_CN.md)。

## 目录

- profiles/set-theory/：助理、检索、人格、并发、资料工具、账号保险库、B 站自主浏览。
- src/app/teaching-hub.js：经过鉴权的本地 Hub 与多群组合。
- tools/import_library.py：可迁移的私有 PDF/OCR 导入器。
- deployment/：Windows OCR 与有退避和验证暂停的 QQ 恢复工具。
- scripts/：私有配置初始化、本机操作命令和验证。
- docs/upstream/：原始项目入口文档。其他继承文件保留用于来源追溯；本助理使用本文的启动入口。

请勿提交 private/、教材原文、提取正文、登录态、Cookie、密钥、二维码、群聊记录或本机测试日志。公开文件仅含源码、合成测试材料和配置示例。

## 验证

```sh
npm run verify
npm run verify:knowledge
npm run audit:public
```

CI 在 Windows、Linux 上运行核心测试及合成 PDF 测试。这验证实现和隔离行为，不是对所有数学回答的正确性认证，也不构成 QQ/B 站永久在线保证。
