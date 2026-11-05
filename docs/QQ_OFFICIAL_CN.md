# QQ 官方 SDK 接入（本地适配）

本地集合论 profile 已增加官方通道，固定依赖 `@tencent-connect/qqbot-nodejs@1.0.5`。
这是独立机器人应用，不是将旧 QQ 2000000002 登录到官方 SDK，也不能解除旧账号限制。
现有 OneBot 默认入口和已验收私有 profile 不会被替换。

## 接入准备

1. 在 https://q.qq.com/ 创建机器人，完成平台要求的认证、测试范围及发布步骤。
2. 从平台取得 AppID 和 AppSecret；AppSecret 只通过本地 `QQBOT_APP_SECRET` 环境变量提供，禁止提交或粘贴到群聊。
3. 由群管理员将官方机器人加入原四群。为每个群确认 `group_openid` 与机器人的 `member_openid`。
   旧群号在本配置中仅作为原群策略的逻辑别名，不能直接调用官方 API。
4. 有条件启用接收所有消息和主动消息。`bot_state` 查询本身可能需要平台白名单权限；拒绝查询时不会假装已验证群关系。

从 upstream 目录准备新的私有配置（不覆盖已有文件）：

```powershell
node scripts/prepare-qq-official.mjs --source private/live-config.json --destination private/qq-official-config.json
node scripts/check-qq-official.mjs private/qq-official-config.json
```

新配置保留原 `profilePath`、模型和知识库设置，生成新的 Hub token、相邻端口和独立运行目录。
填写 `qqOfficial.appId` 及四条群 OpenID 绑定；空白字段会拒绝启动。
`allowProactive` 默认 false。密钥由本机私密环境注入后，才可运行：

```powershell
node profiles/set-theory/start-live.mjs --live --config private/qq-official-config.json
```

使用官方 WebSocket，无需把本地 Hub 暴露到公网。新事件经白名单和身份校验转换后，只投递至已鉴权的 loopback Hub。
不配置 SDK 原始日志记录器，避免把消息正文、平台令牌或媒体 URL 写入日志。
本任务不改 Windows 计划任务，不自动上线，不替换旧 Hub，不进行群消息或模型探测。

## 功能兼容范围

| 功能 | 本地适配结果与边界 |
| --- | --- |
| 阿序、回、固定模型、人文话题路由 | 复用现有 profile 和策略；私聊仍由阿序回复 |
| 教材检索、Jech 原页图像、联网阅读 | 复用原模块；出站图片转换为官方媒体上传 |
| 学习、记忆、反馈、人格审核 | 功能复用；新运行目录保存新身份记忆；旧数据留原处，未自动迁移旧成员记忆或公共学习档案 |
| 普通群与私聊回复 | 群被动窗口 5 分钟、5 次；私聊 60 分钟、4 次；超过截止时间的排队问题不调用模型 |
| 1000000004 | 当前官方事件明确 @ 机器人才能回复；引用旧 @、仅人文话题、@all 均不放行；禁止主动分享 |
| 长回答 | 短文分为最多两条；较长正文预览加完整 answer.txt；图片单独上传。总次数发送前预留，超额拒绝，不截断全文冒充完整回复 |
| 引用 | 使用已接收事件缓存，或平台本次推送中的引用正文；自己发出的回复索引也缓存。没有任意历史拉取或重启后的正文缓存 |
| 群文件 | 只列举本进程接收到的附件；不等于完整群文件目录，重启后需重新收到附件；现有文件解析/教材导入可继续使用 |
| 全群上下文与主动消息 | 依赖平台权限和群设置；主动消息须配置显式允许且最新 bot_state 允许，默认关闭 |
| 合并转发、任意群历史、全目录遍历 | 未提供等价官方能力，不伪造实现；通过文件、当前事件附件和有界缓存替代 |
| 回复回读 | 官方接受响应记录 delivered=true、verified=false；不等于旧 get_msg 回读验收 |
| 私聊准入 | 当前真实官方 C2C 事件授权，不声称已查询 QQ 好友列表；身份与各群隔离 |

## 身份、安全与失败处理

兼容层为 AppID、会话和 OpenID 分配持久内部数字别名，使既有插件可继续使用原校验接口。
这些别名不是 QQ 号，不从昵称猜人，也不将 OpenID 哈希成旧 QQ 号。不同群、私聊、应用均不自动合并记忆。
状态 API 显式暴露 `channel=qq-official`、`identityNamespace`、内部别名标记和能力范围。

不确定的发送在首次外部写入前持久预留次数及防重凭据；超时、部分成功或进程重启后不自动重发同一正文。
媒体先上传（srv_send_msg=false），再显式发送；msg_seq 使用持久预留的序号，重启后不从 1 重用。
消息身份账本上限 100000 项、消息凭据上限 10000 项、写入账本上限 20000 项；达到上限会拒绝继续，需本地维护，不能删除活跃凭据后重发。
群被动窗口也限制推理取消时间。模型选型/推理强度不变，但超过官方回复窗口的长任务无法保持旧平台的即时回复体验。

## 验证与真实验收

```powershell
node --test test/qq-official.test.js
npm run verify
```

离线测试包括 FakeSDK 场景和已安装真实 SDK 的消息构造契约；网络请求被本地替身接管，不访问 QQ 或模型。安装成功、模拟事件通过、SDK ready 都不等于真实群投递验收。
上线后另行核验应用身份、四群绑定/收消息设置、当前真实 @ 与双人格路由、图片/文件回复及失败回执。
接口权限、群授权、内容审查和平台消息限制均以实际应用为准。

参考：
- https://github.com/tencent-connect/qqbot-nodejs
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
- https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html
