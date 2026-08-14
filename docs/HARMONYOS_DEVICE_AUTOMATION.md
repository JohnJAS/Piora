# HarmonyOS NEXT 设备自动化

Piora 0.2.1 提供桌面专用的 HarmonyOS NEXT 设备控制预览。它让用户先在可见设备面板中连接和检查自己的测试手机，再把结构化、受限的 UI 操作交给 AI 执行。

## 支持范围

- Windows x64 桌面版 Piora。
- 用户持有并主动授权的 HarmonyOS NEXT 真机。
- USB/HDC 设备发现与连接诊断。
- 右侧工作区约 1 FPS 的本地设备投屏，以及 UiTest 控件树。
- 点击控件、坐标点击、滑动、文本输入、Back/Home/Recents/Enter。
- 启动明确指定 bundle name 的应用。
- 每台设备独占租约、动作串行化、过期快照拒绝和紧急停止。
- AI 的 `harmony_device` 结构化工具。

不支持绕过开发者模式、USB 授权、锁屏、密码、验证码、支付确认、生物认证或应用自身权限。Piora 不提供 raw HDC shell、安装/卸载、清数据或任意文件操作给 AI。

## 使用前准备

1. 在 Windows 安装最新版 DevEco Studio 或 HarmonyOS Command Line Tools。
2. 确认其中包含 `hdc.exe`。Piora 不随预览包分发 Huawei SDK 二进制。
3. 在手机上开启开发者模式和 USB 调试。
4. 使用数据线连接手机，并在手机上确认本次电脑的调试授权。
5. 建议使用测试手机和测试账号，不要连接包含个人聊天、支付或工作机密的日常主力机。

## 启用设备控制模式

普通 Piora 编码会话拥有完整文件和进程工具，不能作为手机控制的安全边界。Harmony AI 自动化只能在单独的 `device-control` 运行模式中启用。

1. 打开右侧工作区的 **Harmony** 标签。
2. 选择 **进入设备控制模式**。
3. Electron 会显示本地确认，并停止当前 Agent run。
4. Piora 重启内部 standalone 服务；窗口会自动重新连接。
5. 在 Harmony 面板中检查当前模式显示为 `device-control`。

离开该模式时执行同样的切换操作。应用全新启动默认回到普通模式；设备租约和排队动作不会跨重启恢复。

这个模式只收敛新 Piora 服务进程加载的工具和资源。它不是 Windows 沙箱，也不能阻止同一 Windows 用户下已经存在的其他程序直接执行 HDC。

## 配置 HDC

Harmony 面板会按以下顺序寻找运行时：

1. 用户在面板中保存的 `hdc.exe` 绝对路径。
2. `PIORA_HARMONY_HDC_PATH`、`HARMONY_HDC_PATH` 或 `HDC_PATH` 环境变量。
3. DevEco Studio/Command Line Tools 的常见安装目录。
4. 系统 `PATH` 中的候选；候选解析为绝对路径并通过版本探测后才使用。

面板启动时会列出所有找到的候选项，并显示对应的 HDC 与 SDK 路径。可以直接选择候选项，也可以使用 Windows 原生对话框选择 DevEco SDK 文件夹或 `hdc.exe`。如果只选择 SDK 根目录，Piora 会在受限层级内查找版本目录、`openharmony/toolchains` 和 `toolchains`。配置保存在 Piora 桌面数据目录，不写入项目仓库。

## 分离视觉模型与操作模型

在 Harmony 面板中启用“独立视觉模型”，选择一个支持图片输入的模型并保存：

1. `snapshot` 在本地读取当前手机截图和 UI 树。
2. 截图单独发送给所选视觉模型；请求不携带聊天历史、租约令牌、输入文本或凭据，并关闭提示缓存保留。
3. 视觉模型只返回 `SCREEN / CONTROLS / WARNINGS / UNCERTAINTY` 结构化观察。
4. 当前会话的操作模型接收 UI 树与观察文本并决定下一步。原始截图默认不进入操作模型上下文；只有用户显式开启“同时发送原始截图”才会转发。

右侧实时投屏仍是本地轮询，不会因为打开面板就发送给任何模型。只有 AI 调用带截图的 `snapshot` 时才会发生视觉请求。

## 目标模式

输入框工具栏的“目标模式”会把一次请求保持为同一个逻辑运行：

- Agent 每个模型回合结束后，如果目标仍为 active，Piora 会自动发起下一回合。
- Agent 必须使用 `piora_goal complete` 并提供已验证的结果，或使用 `piora_goal blocked` 说明确切阻塞条件。
- 用户可随时点击停止；模型错误也会终止本次运行。
- 为防止失控空转，单次目标运行最多自动续接 64 个回合；触达上限会以 blocked 结束，而不会伪装成完成。

目标模式开关保存在本机浏览器存储中。它不绕过设备授权、敏感操作边界、模型权限或人工确认。

## 手动检查

在把控制交给 AI 前，先完成一次手动检查：

1. 设备列表应显示手机在线；如果显示未授权，请查看手机屏幕上的 USB 调试弹窗。
2. 确认投屏画面持续更新；点击 **读取 UI 树**，确认截图尺寸、旋转方向和控件树正常。
3. 用 **Back** 或在截图上点击一个无副作用区域，确认坐标映射正确。
4. 切换横竖屏后再次刷新，确认旧截图不能继续执行动作。
5. 点击 **紧急停止**，确认租约和排队动作被清除。

如果 `uitest` 命令存在但点击无效果，通常是设备系统版本、测试模式或 UiTest 权限差异。面板会保留结构化诊断结果；不要通过 raw shell 绕过失败关闭。

## 交给 AI

在 `device-control` 模式中新建任务，然后直接描述目标，例如：

> 连接当前唯一的 Harmony 设备，打开 `com.example.demo`，先观察屏幕和控件树，再依次进入设置页、打开深色模式，最后截图验证。不要执行登录、购买、删除或权限变更。

AI 的标准流程是：

1. `list_devices` 查找设备。
2. `acquire_control` 请求当前 run 的本地授权。
3. `snapshot` 读取控件引用和必要截图。
4. 使用 `tap_ref`、`swipe`、`input_text`、`press_key` 或 `launch_app`。
5. 每次页面变化后重新 `snapshot`；旧 revision/ref 会被拒绝。
6. 完成后 `release_control`。

控制授权绑定当前设备、连接 generation、Piora task 和 Agent run，run 结束或超时即撤销。模型拿不到可复制的租约令牌。

## 屏幕数据与模型提供商

手动面板的最新截图只作本地内存缓存。AI 调用 `snapshot` 时，截图或控件文本会成为工具结果：

- 内容可能发送给当前选择的模型提供商。
- 工具结果可能写入 Pi session JSONL，并出现在会话导出中。
- 请先关闭无关通知，并只共享任务所需的 `tree`、`screenshot` 或 `both`。

Piora 不把输入正文、截图字节或完整控件树写入 Harmony 审计日志。第三方 Driver 遥测必须保持关闭。

## 故障排查

| 错误 | 处理方式 |
|---|---|
| `HDC_NOT_FOUND` / `HDC_INVALID` | 选择正确的 `hdc.exe`，然后重新探测 |
| `DEVICE_OFFLINE` | 解锁手机并确认 USB 调试授权 |
| `LEASE_CONFLICT` | 在占用任务中释放控制，或由用户紧急停止 |
| `LEASE_REQUIRED` / `LEASE_EXPIRED` | 重新执行 `acquire_control` 并在本地确认 |
| `STALE_SNAPSHOT` | 重新获取快照，再重新定位控件 |
| `CAPABILITY_UNAVAILABLE` | 当前 HDC/UiTest 版本不支持该动作，或页面禁止捕获；Piora 不会绕过系统限制 |
| `COMMAND_TIMEOUT` | 先刷新投屏确认动作是否已经发生，禁止盲目重复 |
| `COMMAND_FAILED` | 查看面板诊断、设备授权和 USB 连接后重试 |

## 发布与验证边界

GitHub 的 `harmony-v*` 预览工作流会在 Windows runner 上执行 lint、TypeScript、单元测试、standalone 打包验证和 packaged-runtime smoke，并发布带 SHA-256 的 portable prerelease。

CI 没有连接实体 HarmonyOS 手机，因此它不能证明某一具体机型、系统版本和第三方 App 的行为。发布包首次使用时仍必须完成上面的手动检查。真正的硬件验收至少应覆盖目标机型上的 UI 树、截图、点击、中文输入、旋转、拔插、重启和连续操作。

GitHub 托管 runner 会对解包后的 Electron 应用执行完整端到端启动烟测，
并对最终 portable wrapper 执行 PE 结构和 7-Zip 内嵌归档完整性检查。
最终单文件 EXE 的完整首次自解压启动在发布机本地执行；托管 runner 不以
NSIS 首次提取耗时作为应用可运行性的判断，因为该路径会受共享主机防病毒扫描影响。
