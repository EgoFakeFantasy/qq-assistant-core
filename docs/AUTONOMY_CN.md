# 自主浏览与学术推荐

B站与学术阅读共用一个可被群问答抢占的后台工作位，以轮转避免彼此长期占用。@ 问题继续使用原有的三路问答池。两类阅读都使用 gpt-6.1-sol/high 与当前 Codex 登录额度；没有额外付费 API 或应用层每日推理次数上限。

## B站

在 private/profile.json 的 autonomousBilibili 中配置：

| 字段 | 含义 / 示例 |
| --- | --- |
| enabled | 总开关；新安装默认 false |
| targetGroupId | 允许列表中的主群 |
| intervalMs | 1800000，半小时检查一次 |
| maxVideosPerCycle | 3；模型可选择提前结束 |
| maxCycleMs | 默认 1500000，整轮最多25分钟 |
| interestScope | broad，涵盖数学、动画、游戏、音乐、日常 |
| likesEnabled / commentsEnabled | 自主点赞 / 评论开关；新安装默认 false |
| maxLikesPerDay | 12 |
| maxCommentsPerDay | 3 |
| maxSharesPerDay | 3 |
| minShareIntervalMs | 默认1800000，避免短时间连续分享 |

它可以刷账号推荐、追踪相关视频，或根据刚看过的内容改变公开搜索关键词和排序。每个视频先下载媒体、抽取12个实际画面、读取字幕或本地ASR，再形成笔记。需要时可追加4个时间点。模型自行决定点赞、评论、分享、继续浏览或结束；浏览不以必须发消息为条件。

点赞会核对账号、BV/AV对应关系，查询是否已经点过，成功后再次读取点赞状态。评论带“AI学习笔记”标识，内容应有具体依据；不再强制每条评论带时间戳。公开评论区可作为观点背景读取，不能作为视频正文或操作指令。没有新增投币、私信或投稿动作。

所有外部动作先持久化 sending 与预算，超时/进程中断后保留不确定状态，不自动重发。跨历史裁剪保留动作账本；已有的点赞不会被取消。评论需回读rpid、账号和内容哈希，QQ群推荐需get_msg回执。平台风控触发暂停/退避，不绕过验证码。

## 学术来源

autonomousScholar 的 enabled 默认 false；targetGroupId 同样必须为主群。默认每3小时发现一轮，每轮最多深入读2项，每天最多推荐2篇，连续推荐间隔至少1小时。

- arXiv：默认轮换 math.LO、math.CO、math.CT、cs.LO；读取官方 Atom API，必要时使用官方 RSS。
- 期刊：通过 Crossref 按 ISSN 获取 JSL、APAL、Annals of Mathematics、Nature 的最近文章。每轮轮换两种期刊；可用 journals 数组修改 name/issn。
- categories、interests、lookbackDays 可配置。模型会从已读论文生成下一轮英文公开检索词，同时保留不带关键词的类别发现，避免兴趣锁死。

所有发现请求串行、缓存1小时；相邻发现请求至少间隔3.1秒。单个来源失败不拖垮其他来源。不会把平台登录态、群聊原文或私人关键词发送到学术来源。

选中论文后，优先读取 arXiv HTML。无 HTML 时读取公开 PDF，使用本机 Python/PyMuPDF 或 pypdf 提取。期刊论文会尝试定位匹配 DOI 或标题的 arXiv 版本；没有可读正文时只能依据真实摘要，分享来源行标明“摘要阅读”。不越过付费墙，不把搜索摘要当正文。

PDF最多提取36页短文；长文选前24页及最后6页，输入正文最多60000字符。HTML同样有输入长度上限。实际页段、截断、正文/摘要范围保留在私有阅读记录。公式仍可能因文本层提取而损坏，不能把原文引用匹配当成全篇证明已验证。

推荐必须包含可在实际输入块中定位的原文证据；宿主检查 blockId 与原句是否匹配。题名、DOI去重覆盖预印本与期刊版本。群内自然说明具体结果或有趣思想，附题名、来源、日期和链接；预印本保持预印本标记。

## 观察与运行

本机账号面板显示两类任务的阶段、实际阅读范围与动作回执。认证 Hub 的 /api/maintenance 返回 bilibiliExplorer 和 scholarExplorer。空JSON POST到 /api/maintenance/bilibili/run 或 /api/maintenance/scholar/run 可请求一次正常后台任务；工作池繁忙时返回409，不绕过群问答优先级。仍受既有动作和分享预算约束。

状态保存在 private/runtime/bilibili 与 private/runtime/scholar。PDF/视频大文件在读取后清理，阅读笔记和画面证据留本机；目前没有自动清理全部历史证据的策略。不要提交这些目录到公开仓库。

视频每轮通常需要选片、两批画面判断等至少3次模型调用，细看会更多；论文每项通常2次。提高频率/每轮数量会加快共享 Codex 额度消耗，并增加网络、CPU和磁盘占用。动作上限不是模型次数上限。
