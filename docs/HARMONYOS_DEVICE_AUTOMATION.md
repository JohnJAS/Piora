# HarmonyOS NEXT 设备自动化

Piora 在统一桌面版本中提供 HarmonyOS NEXT 设备控制能力。它保留现有 HDC 投屏实现，同时用持久 Hypium/UiTest RPC 会话执行高频 UI 操作，让模型可以在一次工具调用中完成带等待和断言的完整测试流程。

## 支持范围

- Windows x64 桌面版 Piora。
- 用户持有并主动授权的 HarmonyOS NEXT 真机。
- USB/HDC 设备发现与连接诊断。
- 右侧工作区约 1 FPS 的本地设备投屏，以及 UiTest 控件树。
- 持久 Hypium 语义点击、双击、长按、输入、清空、滚动查找、滑动、Back/Home/Recents/Enter；驱动不可连接时自动退回安全的 HDC/UiTest 能力。
- 使用 id、文本、类型、hint、无障碍描述、组件状态和索引组合定位控件，歧义目标不会盲点。
- 启动、停止、安装、卸载测试应用以及清理测试应用数据。
- 等待控件出现、消失或 enabled/checked/selected/visible 状态变化。
- 固定等待，以及基于本地 PNG 像素采样的全屏/指定区域稳定等待。
- 每台设备独占租约、同设备动作串行、多设备并行、过期快照拒绝和紧急停止。
- AI 首选的 `harmony_run_scenario` 批量工具，以及向后兼容的单步工具。

不支持绕过开发者模式、USB 授权、锁屏、密码、验证码、支付确认、生物认证或应用自身权限。Piora 不向 AI 提供 raw HDC shell 或任意文件操作；安装、卸载和清数据只接受结构化场景中的明确 HAP 路径或 bundle name，应只用于测试设备和测试应用。

## 使用前准备

1. 在 Windows 安装最新版 DevEco Studio 或 HarmonyOS Command Line Tools。
2. 确认其中包含 `hdc.exe`。Piora 不随预览包分发 Huawei SDK 二进制。
3. 在手机上开启开发者模式和 USB 调试。
4. 使用数据线连接手机，并在手机上确认本次电脑的调试授权。
5. 建议使用测试手机和测试账号，不要连接包含个人聊天、支付或工作机密的日常主力机。

## 在现有会话中使用

打开右侧工作区的 **Harmony** 标签即可查看和手动控制设备；不需要切换运行模式、停止当前任务或重启服务。现有会话会直接加载 `harmony_*` 设备工具，同时保留原有编码工具、项目扩展、skills 和 prompts。

这意味着普通会话与手机控制不构成进程或工具隔离。手机上显示的内容以及项目/第三方扩展都必须按不可信输入处理。控制权绑定当前 prompt run，模型拿不到租约令牌；运行结束、取消、超时或紧急停止都会回收控制。

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

## 混合自动化驱动

- 设备发现、截图、UI 树、应用生命周期、文件传输、录屏和现有视频投屏继续由已经验证的 HDC backend 完成。
- 第一次 UI 操作会按设备懒加载 `hypium-driver` 并建立 UiTest RPC；后续步骤复用同一个连接，避免每步启动命令和 agent。
- Hypium 在连接前强制关闭第三方遥测；无法确认关闭时拒绝启动该驱动。
- 连接建立前失败会进入短暂冷却，并退回原有 HDC 操作。已经发出的 RPC 如果失败不会再用 HDC 重放，避免一次点击或输入被执行两次。
- 设备断开、取消、急停、配置切换或进程退出时会断开并清理持久会话。
- `harmony_run_scenario` 最多接受 64 步、单个等待最长 60 秒、整个场景最长 5 分钟；失败后停止剩余写操作并返回失败步骤。

## 智能等待

页面操作后优先等待可验证的完成条件，而不是猜一个固定延迟：

- `wait_for` 默认每 500 ms 读取一次 UI 树，可等待文本或 resource id 出现、消失，或节点的 `enabled`、`checked`、`selected`、`visible` 状态。默认超时 10 秒，最长 60 秒。
- `wait_until_stable` 在本地解码并采样连续 PNG 帧。默认画面变化像素不超过 0.5%，连续稳定 1 秒后继续；可指定屏幕区域，避开状态栏、时钟等无关变化。截图不会因为稳定检测自动发送给视觉模型，只有最终工具结果按现有视觉配置处理。
- `wait_ms` 提供 100 ms 到 60 秒的可中止固定等待，只应在没有可观察完成条件时作为兜底。

所有场景步骤都会返回状态、耗时和实际执行策略；超时会报告结构化失败。设备断开、用户停止或 prompt run 结束时，等待会随租约一起中止。

画面稳定只代表采样区域在阈值内不再变化，不代表业务一定成功。测试仍应在稳定后使用 UI 树、截图或业务结果进行断言。对于循环粒子、视频、光标闪烁等持续动画，应缩小检测区域或改等结构化状态。

## 手动检查

在把控制交给 AI 前，先完成一次手动检查：

1. 设备列表应显示手机在线；如果显示未授权，请查看手机屏幕上的 USB 调试弹窗。
2. 确认投屏画面持续更新；点击 **读取 UI 树**，确认截图尺寸、旋转方向和控件树正常。
3. 用 **Back** 或在截图上点击一个无副作用区域，确认坐标映射正确。
4. 切换横竖屏后再次刷新，确认旧截图不能继续执行动作。
5. 点击 **紧急停止**，确认租约和排队动作被清除。

如果 `uitest` 命令存在但点击无效果，通常是设备系统版本、测试模式或 UiTest 权限差异。面板会保留结构化诊断结果；不要通过 raw shell 绕过失败关闭。

## 交给 AI

在任意现有任务或新任务中直接描述目标，例如：

> 连接当前唯一的 Harmony 设备，打开 `com.example.demo`，先观察屏幕和控件树，再依次进入设置页、打开深色模式，最后截图验证。不要执行登录、购买、删除或权限变更。

AI 的标准流程是：

1. `harmony_list_devices` 查找设备。
2. 已知测试路径时直接调用 `harmony_run_scenario`；它会自动取得本轮控制权，并在同一设备队列与持久 UiTest 会话中执行全部步骤。
3. 选择器优先使用稳定 resource id，其次是无障碍 description/hint，再次是可见文本与类型组合；可能重复时增加状态或 index。
4. 每个会改变页面的步骤使用 `waitFor`，关键业务结果增加 `assert`，长列表目标使用有次数上限的 `scroll_find`。
5. 只有探索未知页面或失败恢复时才使用 `harmony_observe_screen` 和兼容的单步工具。观察默认只返回 UI 树；确实需要视觉判断或证据时再请求截图。
6. 完成后可显式 `harmony_release_control`；prompt run 结束也会自动释放。

场景示例（工具参数中的输入文本不会出现在结果中）：

```json
{
  "steps": [
    { "action": "launch_app", "bundleName": "com.example.demo", "waitFor": { "selector": { "id": "home" } } },
    { "action": "tap", "selector": { "id": "settings" }, "waitFor": { "selector": { "text": "设置" } } },
    { "action": "tap", "selector": { "id": "dark-mode", "checked": false } },
    { "action": "assert", "condition": { "selector": { "id": "dark-mode", "checked": true } } }
  ]
}
```

控制授权绑定当前设备、连接 generation、Piora task 和 Agent run，run 结束或超时即撤销。模型拿不到可复制的租约令牌。

## 屏幕数据与模型提供商

手动面板的最新截图只作本地内存缓存。AI 调用观察或场景最终截图时，截图或控件文本会成为工具结果：

- 内容可能发送给当前选择的模型提供商。
- 工具结果可能写入 Pi session JSONL，并出现在会话导出中。
- 请先关闭无关通知，并只共享任务所需的 `tree`、`screenshot` 或 `both`。

Piora 不把输入正文、截图字节或完整控件树写入 Harmony 审计日志。Hypium 遥测由运行时强制关闭；如果无法写入隐私配置，Piora 不会加载该驱动。

## 故障排查

| 错误 | 处理方式 |
|---|---|
| `HDC_NOT_FOUND` / `HDC_INVALID` | 选择正确的 `hdc.exe`，然后重新探测 |
| `DEVICE_OFFLINE` | 解锁手机并确认 USB 调试授权 |
| `LEASE_CONFLICT` | 在占用任务中释放控制，或由用户紧急停止 |
| `LEASE_REQUIRED` / `LEASE_EXPIRED` | 重新调用场景工具自动获取本轮租约，或使用兼容的 `harmony_acquire_control` |
| `STALE_SNAPSHOT` | 重新获取快照，再重新定位控件 |
| `CAPABILITY_UNAVAILABLE` | 当前 HDC/UiTest 版本不支持该动作，或页面禁止捕获；Piora 不会绕过系统限制 |
| `AUTOMATION_DRIVER_UNAVAILABLE` | Hypium 无法连接；Piora 会对可安全降级的动作使用 HDC，并在冷却后重试持久驱动 |
| `AUTOMATION_DRIVER_FAILED` | 已连接的 RPC 在动作期间失败；先观察实际页面，Piora 不会自动重放写操作 |
| `UI_TARGET_NOT_FOUND` / `UI_TARGET_AMBIGUOUS` | 改用更稳定或更精确的语义选择器，必要时先观察 UI 树 |
| `SCENARIO_FAILED` | 场景断言失败；检查返回的失败步骤和最终 UI 树 |
| `COMMAND_TIMEOUT` | 先刷新投屏确认动作是否已经发生，禁止盲目重复 |
| `COMMAND_FAILED` | 查看面板诊断、设备授权和 USB 连接后重试 |

## 发布与验证边界

GitHub 的标准 `v*` 发布工作流会在 Windows runner 上执行 lint、TypeScript、单元测试、standalone 打包验证和 packaged-runtime smoke，并发布带 SHA-256 的 portable 版本。

CI 没有连接实体 HarmonyOS 手机，因此它不能证明某一具体机型、系统版本和第三方 App 的行为。发布包首次使用时仍必须完成上面的手动检查。真正的硬件验收至少应覆盖目标机型上的 UI 树、截图、点击、中文输入、旋转、拔插、重启和连续操作。

GitHub 托管 runner 会对解包后的 Electron 应用执行完整端到端启动烟测，
并对最终 portable wrapper 执行 PE 结构和 7-Zip 内嵌归档完整性检查。
最终单文件 EXE 的完整首次自解压启动在发布机本地执行；托管 runner 不以
NSIS 首次提取耗时作为应用可运行性的判断，因为该路径会受共享主机防病毒扫描影响。
