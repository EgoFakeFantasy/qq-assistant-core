# 可选回人格

[English](SECONDARY_PERSONA.md)

阿序保持 gpt-6.1-sol/high。已验收的可选回后端使用独立认证的 Antigravity CLI；本次发布不包含 Gemini 网页自动化。

## 激活

私有人格配置可设置 secondaryPersona 为 {enabled:true,name:'回',argonMinRemaining:0.2,canary:null,activationMode:'mentioned-name'}。公开默认关闭。必须同时满足当前消息真实 @ 本账号、明确称呼回。引用、旧消息、模型别名、伪造 requestedPersona 或 Codex 额度耗尽都不能在此模式唤起回。凭据或额度不可用时如实失败，不能让 GPT 冒充回。

## 配置与执行

在 private/live-config.json 设置 antigravity.executable 与 antigravity.isolatedHome，并在本机完成 CLI 登录。不发布或继承桌面令牌、API 密钥。主副人格模板分别在 profiles/set-theory/prompts/；共享数学、引用、表达和资料权限仍有效。

回使用同一有界知识及资料研究循环，只给当前问题图片副本授予读取权限。禁止原生命令、沙箱外执行、写入、浏览器动作及第三方 MCP。图片请求使用 request-review 并保持上述禁止；无图及额度请求仍为 strict。额外权限、明确拒绝、工作目录变化均拒绝继续；不使用 API 积分兜底。

## 验证与限制

此前本机已验收真实教材检索、原页读取、引用、人类 QQ @ 的发送与回读。公开测试只使用合成数据与模拟后端，不能证明新账号或新安装可用。公开配置不会自动开启后端。当前路由与 mentions-only 规则有独立回归测试；记忆候选不能改变路由或人格模板。
