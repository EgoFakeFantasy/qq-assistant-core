# 本机运维

## QQ 登录与守护

Windows 守护程序在电脑接电、当前 Windows 用户已交互登录时补起缺失的 Hub 与账号面板进程。如需同时启动 NapCat 的 Node 启动器，请在 private/live-config.json 中填写单独安装的 napcatNodePath、napcatEntryPath；QQ 的工作目录固定为启动器所在目录。不要为相同账号和端口同时运行两套独立 NapCat。

可选的密码恢复只使用配置的 QQ 账号：

```powershell
powershell.exe -NoProfile -File deployment/store-qq-credential.ps1
powershell.exe -NoProfile -File deployment/supervise-runtime.ps1 -Once
powershell.exe -NoProfile -File deployment/install-supervisor.ps1
```

第一条在本机终端安全提示输入密码，不要往 QQ 群粘贴密码。第三条安装低权限、当前交互用户的 Windows 任务，每分钟检查一次。克隆仓库、安装 npm 依赖和运行测试均不会执行这些运维操作。

密码使用 Windows DPAPI CurrentUser 加密；恢复时仅通过匿名标准输入管道向固定回环 WebUI 接口传递登录所需的密码表示。状态文件只记录脱敏阶段与退避时间，不记录密码、摘要、验证地址或二维码内容。

恢复会核对实际登录账号，优先使用有效的已保存会话，再尝试保护存储中的密码，并遵守互斥锁、指数退避、失败次数上限和验证暂停。不反复重启 QQ、不重置设备标识、不绕过正在等待的验证。验证码、手机确认或扫码仍可能需要操作者参与，不能保证永久不掉线。

npm run health 区分 Hub、OneBot、QQ 实际登录、允许群的成员关系和 Hub 分群连接刷新。进程存在或 WebUI 面板登录成功，都不能单独证明机器人上线。

## 迁移部署

迁移源码，在目标机器安装依赖、生成私有配置，重新登录 Codex 和平台账号，并从有权使用的本地资料重建知识库。Windows DPAPI 密文绑定原用户和系统环境，不能当作通用密码文件跨机器复制使用。

仓库不包含 Codex、NapCat、FFmpeg、Whisper 模型、教材、已有私有索引或登录态。本次发布不认证通用云部署、其他系统的账号保险库或平台风控后完全无人参与的重新认证。
