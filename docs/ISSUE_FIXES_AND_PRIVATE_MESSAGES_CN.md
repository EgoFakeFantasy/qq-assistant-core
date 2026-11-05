# 六项 issue 修复与 QQ 私信回复

在部署者自有 profile 中开启：
```json
{"privateMessages":{"enabled":true,"maxConversations":64},"quotaTimeZone":"Asia/Shanghai"}
```

仅接受已认证 OneBot 送来的、发给当前机器人账号的好友私信。宿主核验真实在线、登录账号和好友列表；陌生人、群临时会话、机器人、自身回声不启动问答。不增加自动通过好友或主动私聊外发。

每位联系人使用 private:<userId> 命名空间，在 private/runtime/private-conversations/<userId> 独立保存队列、题目目录、上下文、持久状态和仅候选生效的长期记忆。群号保持原样。私信占用原有问答池并发额度，重启恢复排队；发送结果不确定时不自动重发。maxConversations 限制已保存联系人数，也包括暂未加载的旧联系人；扩容或归档空闲会话由部署者操作，不静默淘汰记录。

私信由阿序 / gpt-6.1-sol/high 回复，提及“回”或引用旧 @ 都不会切换提供者；原有群回复与回的触发规则保持。私信可检索已配置的基础教材库，没有群文件库、群聊天记忆、其他联系人的上下文或平台账号工具。收到的私信图片、文件标记为未读；本轮未实现私信文件入库和收图视觉理解。

发送前读取真实原消息，核对联系人并重新检查好友关系；使用 send_private_msg 或 send_private_forward_msg，并尝试 get_msg 与合并内容回读。接口返回消息编号和 verified=true 分别记录；回读失败不会再发一遍。

六项修复：

1. definitionIntent 现已传到底层教材排序，只有关键词的后续检索也能保留定义意图。
2. Kanamori / Higher Infinite 尚未导入时，返回 missingRequestedBooks，同时按主题检索其他已导入资料。精确读缺失书籍页码的命令不会拿另一本书的同页替代；其他来源命中不代表读过缺书。
3. 长 PDF 仍按前24页与末6页限量抽取；在60000字符输入预算后返回实际 readRanges、missingRanges、truncatedPages。节选阅读明确标记，不可引用未读页，结论范围必须为 provided-excerpts。48页文章的25–42页会明确列为未读。引文匹配不能证明整篇证明已核验。
4. 尝试公开期刊 HTML 和可用 PDF，期刊 PDF 优先 Crossref text-mining 链接；最多两条 HTML、三条 PDF。无法取得正文时保留真实的仅摘要状态，不绕过登录、访问限制或付费墙。
5. quotaTimeZone 默认 Asia/Shanghai；运行配置根字段可覆盖 profile，单项浏览配置也可单独指定。问答、B站、学术每日限额使用同一日期函数；无效时区启动失败。dailyModelCalls=null 仍不设应用层每日推理次数上限。
6. Hub、视觉索引、OCR 共用 PID 锁。兼容纯 PID 和 JSON，死进程锁可回收；活进程、EPERM、格式损坏和已更换所有者的锁不会被覆盖。PID 复用按仍活着保守处理；这是本机文件锁，不是分布式租约。

验证命令为 npm run verify、npm run verify:knowledge、npm run audit:public；专项回归为 issues-regression.test.mjs 与 private-replies.test.mjs。回归只用合成资料与注入模型、传输，不代表真实 QQ 私信已经验收。空闲时重新加载 Hub 后，还须由真实用户私信触发，核对新推理和实际回读。运行记录和真实聊天只留私有目录。
