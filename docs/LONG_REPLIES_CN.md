# 长回复与聊天记录

QQ群回复在发送前经过统一排版检查。默认超过500个可见字符，或超过12行，即发送一张QQ合并转发聊天记录卡片；阈值以内仍为普通消息。正文、教材引用、网页来源和图片说明一起计入长度。

这是完整内容的折叠呈现，不是模型摘要：按段落、句子和Unicode字形安全分段，顺序与所有正文字符保持不变；图片放在卡片最后。每个节点均使用实际机器人QQ号和昵称，首节点保留简短问题摘要，不冒充其他群友。QQ实测会丢弃节点里的原生回复关联，因此不依赖该关联表示对应问题。普通问答、B站和论文主动推荐共用同一边界。

在私有profile.json中可配置：

```json
"replyPresentation": {
  "inlineMaxCharacters": 500,
  "inlineMaxLines": 12,
  "forwardNodeCharacters": 800
}
```

inlineMaxCharacters允许100–2000，inlineMaxLines允许3–40，forwardNodeCharacters允许600–2000。修改后在空闲时重载Hub，保留QQ登录和排队消息。群内消息不能改这些配置。默认值也适用于未填写该配置的旧部署。

一次只提交一次发送请求。返回message_id后，核对外层消息确属当前群且由当前机器人发送，再用get_forward_msg回读卡片，核验节点作者、全文与图片数量。回读成功的群回复会记录deliveryMode=forward、verified=true和nodeCount。发送结果不确定时不自动重发，也不把长正文改发为刷屏消息。

QQ/NapCat部分版本的转发子节点group_id可能是占位值，因此权限依据外层get_msg的真实群和作者；不根据子节点群号扩大读取范围。仅展开本机器人在本群发出的受限卡片，禁止递归展开陌生嵌套记录。引用自己的长回复时可读取完整正文和卡片中的图片。

日常人格优先1–3句、通常200字以内；数学证明保留必要假设、推理与真实引用。原有模型、每日次数设置、搜索、知识库和表情原则保持独立。正文原有上限仍为6000个UTF-16单元，完整出站文字另有16000字形及64节点边界；超过后失败，不静默截断。

研究依据：NapCat[合并转发接口](https://doc.napneko.icu/develop/api/doc#send-forward-msg-%E5%8F%91%E9%80%81%E5%90%88%E5%B9%B6%E8%BD%AC%E5%8F%91-normal-native)及本机安装版本的send_group_forward_msg/get_forward_msg实现。自定义news、prompt等预览参数受客户端限制，本实现使用原生卡片，不依赖伪造预览。
