# LLBot OneBot 适配

实现位于 profiles/set-theory/llbot-runtime.mjs，兼容 LuckyLilliaBot v8.3.2 配置。账号和群列表读取新运营者的私有 profile，不依赖原账号。所有例号为虚构。

## 准备

先按 REUSE_CN.md 初始化，下载官方发行包并核验 GitHub 发布摘要，解压到 private/llbot/vendor/v8.3.2，然后运行：

    node scripts/prepare-llbot.mjs . private/llbot/vendor/v8.3.2

准备器仅创建 private/llbot/live-config.json、部署清单和桥接配置，保留原 profilePath、memoryRoot 与鉴权。拒绝覆盖已有配置。WebUI 绑定 127.0.0.1:3080，OneBot 复用配置端口；Milky/Satori/WebSocket、离线事件和 HTTP POST 转发初始关闭。

## 项目授权与启动

Auth Token 是 LLBot 项目凭据，与 QQ 密码、本机 WebUI 密码、OneBot/Hub 密钥不同。合法 token 放在私有 vendor 的 bin/llbot/data/auth_token.txt，不进入版本控制。2026-11-03 项目授权站 https://auth.luckylillia.com 拒绝新用户注册；没有现成合法 token 时不能完成此路线，不绕过授权。

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File deployment/start-llbot.ps1 -QqPath 'C:/Program Files/Tencent/QQNT/QQ.exe'
    node deployment/runtime-health.mjs

启动器校验 manifest、原配置身份和 token，使用部署监督/登录互斥，保护现有在线或确认中会话。选择 llbot 后，监督仅只读监控，旧恢复器不运行。启动进程不等于 QQ 在线。真实账号、在线和全部配置群必须分别通过，再由运营者明确启用事件转发。

## 验证边界

离线测试覆盖配置、HMAC 入站、当前真实 @ 及人格约束，不消耗模型或发真实群消息。面板在线不能证明 QQ 在线，也不能说明账号群聊限制解除。图片、附件、历史读回及 OneBot 扩展需实际登录后独立验收。不上传第三方二进制、登录状态或私人记录。
