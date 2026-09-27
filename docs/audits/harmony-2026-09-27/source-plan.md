# Piora 鸿蒙设备 Agent 商用化改造执行书

**用途：直接交给 Codex 分批实施；本文件不是已完成的实施报告。**
审计日期：2026-09-27
审计仓库：`kexijiang/Piora`
审计基线：`53544c6d836f21d94103c7b659cc668edc87a58c`（当次读取的 main）
根包版本：`0.5.2-beta.9`；Node 要求：`>=22.19.0`；当前 `hypium-driver`：`6.1.210`。

## 0. 执行摘要与边界

本轮结论不是“鸿蒙功能基本没有”，也不是“需要重写 Pi”。当前已经具备 HDC 发现、截图和控件树、Hypium 持久连接、语义选择器、屏幕点击/长按/滑动、文本输入、应用生命周期、等待断言、场景执行、投屏、录屏、日志、每设备队列和运行期租约。

真正的差距在于：能力描述过粗；屏幕操作与实体按键语义不完整；没有真正的手机语音输入链路；观察失败时存在不安全兜底；设备控制、租约撤销和资源清理没有完全闭合；多处协议与文档存在漂移；实机商业验收尚未形成发布门禁。

**实施顺序：先修正确性和停止边界，再统一协议，再增加电源键长按与真实语音，再完善工作台、诊断和发布。不要先做 UI 大改，也不要一次移动所有目录。**

### 0.1 本次审计证据范围

通过 GitHub 连接器锁定提交，逐段读取设备核心类型、Manager、HDC/Hybrid/Hypium 后端、场景执行器、Agent 扩展、HTTP 权限与动作接口、前端设备面板及投屏 hook、README/AGENTS、目录树和 CI 配置。重点是“Agent → 扩展 → Manager → 后端 → 设备”的实际执行路径。

本环境未能取得可运行的完整本地 checkout，未执行 `npm ci`、测试或连接实体手机。因此：

- “确认”指源码可以直接证明的行为、遗漏或不一致，不表示已经在用户手机上复现。
- “条件性问题”指当指定条件出现时该代码路径缺少保障，需要构造测试或实机证实。
- “建议/目标”不是仓库现有功能，更不是已经达到的性能数据。
- 文件是否可删除，必须结合完整引用图、构建输入、运行时加载、发布清单和历史兼容性；不能把搜索没有命中当成删除证明。

### 0.2 不允许破坏的现有能力

1. 保留 Pi 的 AgentSession/Extension/工具调用机制，不重写推理循环，不修改上游 Pi 内核来承载设备状态。
2. 保留统一普通会话；没有 HDC、没有手机或驱动崩溃，不得阻止普通编码。
3. 会话切换、面板隐藏、聊天页面重挂载，不得取消另一个会话正在执行的 Agent 任务。
4. 保留同设备动作串行、多设备并行；不得退化为整个程序只有一条设备队列。
5. 保留现有 HDC 与 Hypium 的混合路线、无副作用失败才降级的原则、结构化错误、截图隐私和桌面接口认证。
6. 保留 Piora/XiaoYiHarness 各自品牌、数据目录、发布和官网边界；共享物理手机的互斥不能因品牌不同失效。
7. 修复必须附运行行为测试，不能只修改文案、增加布尔值或添加永远返回成功的占位实现。

## 1. 已确认的问题与需要复现的风险

### F01 / P0：语义点击在识别失败时退回旧坐标【确认】

来源：`lib/harmony/device-manager.ts::tapRef`。[S01]

当前逻辑包括 `semantic_relaxed`、`nearby_bounds` 和 `captured_bounds_fallback`。特别是重新读取的 `freshNodes.length === 0` 时，会使用旧节点中心继续点击。保留快照限制为 4 份，但保留结构中没有目标最大年龄；“只保留少量快照”不等于“快照一定新鲜”。

**后果：** UI 树缺失/解析失败可能被转换成一次真实点击；页面跳转、弹窗或遮挡后可能点错。

**修复：** 默认语义引用必须通过有效的新观察和唯一匹配；空树不得证明旧节点有效。Canvas 等无树场景保留独立的、显式视觉坐标操作，要求新帧、几何映射、目标区域和风险规则，不能藏在语义点击的自动兜底里。

### F02 / P0：投屏坐标与设备输入坐标缺乏显式转换契约【条件性问题，链路缺口确认】

来源：`HarmonyPanel.tsx::imagePoint`、`hooks/useHarmonyLiveFrame.ts`、`app/api/harmony/action/route.ts`、`hdc-backend.ts` 的镜像参数和 `tap`。[S02][S03][S04][S05]

前端按解码视频宽高计算点击点，动作接口直接把坐标交给 Manager/HDC。视频后端设有 `MIRROR_MAX_SHORT_EDGE = 1080`，而协议没有完整的“原生输入尺寸、视频尺寸、裁剪、旋转、显示器”转换描述。

**触发条件：** 视频与输入屏幕尺寸不同、旋转/折叠、裁剪、多显示器或映射变化。不能假定所有手机都触发，但也不能拿 1080 宽手机工作正常证明其他机型正常。

**修复：** 服务端发行 `geometryId` 和转换数据；前端提交帧空间坐标及几何引用，服务端变换并检查。连接 generation 不能替代几何代际。

### F03 / P0：存在卸载/清数据能力，但审批接口没有成为实际授权边界【确认】

来源：`extensions/piora-harmony.ts::ensureAgentLease/acquire_control/harmonyRunScenarioTool`；`scenario-executor.ts::executeStep`；`app/api/harmony/approval/route.ts`。[S06][S07][S08]

Agent 自动取得租约；场景可执行 `install_app`、`uninstall_app`、`clear_app_data`。当前验证会检查参数形态、bundle name、HAP 路径等，但读取的执行链路未建立测试应用允许名单和一次性动作授权。`approval/route.ts` 自身说明是 metadata-only，不授予执行权；其文案仍声称存在 native per-run confirmation，与扩展直接获取租约不一致。

**重要区分：** HTTP 已有桌面 token 和请求来源验证，不是完全无认证接口。[S09] 问题是“哪个已认证 Agent 被允许在什么手机、什么应用上执行什么动作”，不是没有任何认证。

**修复：** 实现明确的设备/任务授权及破坏性动作授权；普通低风险动作在授权范围内自动执行，禁止每点一下都弹确认。身份、租约、授权是三个不同概念。

### F04 / P0：撤销租约与中止在途操作没有统一为同一生命周期【确认】

来源：`device-manager.ts::removeLease/releaseLease/sweepExpiredLeases/releaseOwner/runScenario/emergencyStop`。[S01]

`removeLease` 删除映射并发事件；`releaseOwner` 另行中止 owner controllers。过期清理是按调用触发，租约结构没有直接保存连接代际。场景有步前检查和等待循环检查，这是有效保护，但不能覆盖所有在途 RPC、阻塞调用或未来音频/按键保持操作。

急停会中止控制器、处理录屏并清理租约，但在异步清理之前没有一个统一、可见的 admission-stopping 状态；录屏回收/下载与停止完成耦合。不能只靠一次 AbortSignal 就宣称设备已经物理停止。

**修复：** 同步关闭新写入入口、递增执行栅栏、撤销租约，再做有时限的资源清理。区分 `stop requested`、`dispatch blocked`、`device cleanup confirmed`、`cleanup uncertain`。增加单设备停止，保留显式全局急停。

### F05 / P0：空观察可能让“控件已消失”断言误通过【确认】

来源：`scenario-executor.ts::waitFor`。[S07]

目前 `latest.nodes ?? []` 被当作可查询集合，`exists:false` 在没有匹配时通过。数据类型没有区分“有效空结果”和“树不可用/解析不完整”。

**修复：** 引入观察质量状态。缺失、失败或不完整观察不能证明目标不存在；负向断言需要有效观察范围与窗口/应用上下文。有效完整观察中的无匹配，才可用于证明消失。

### F06 / P1：能力表只有少量布尔值，无法准确表达真实可用性【确认】

来源：`types.ts::HarmonyCapabilities`、`hdc-backend.ts::capabilitiesForUiTest`、`hybrid-backend.ts::listDevices`。[S05][S10][S11]

当前只有 UI 树、截图、tap、swipe、inputText、keys、launchApp 等布尔值。HDC 会按 UiTest 版本判断部分能力，不能说完全没有探测；但该表不足以描述长按、录屏、清空、语义定位、实体键长按、语音等，更不能区分 Hypium 可用而 CLI 不可用、权限不足和暂时冷却。

**修复：** 按动作、参数和后端记录 `supported/unsupported/unknown/degraded`，附原因、限制、证据、测试时间；硬件兼容认证与当前运行时探测分开存储。

### F07 / P1：目前没有实体电源键长按或手机音频输入契约【确认】

来源：`types.ts`、各后端、Agent/HTTP 的 `press_key` 枚举。[S04][S05][S06][S10]

硬件键仅有 back/home/recents/enter。`long_press` 是屏幕坐标/控件长按，并非 power hold，也没有按住后持续播放音频的资源模型。桌面端转写用户说话，不等于让手机的语音识别接收到音频。

**修复：** 分别实现实体键、触摸保持和语音链路，禁止混用同一个含义不清的 `long_press`。

### F08 / P1：部分降级会改变动作语义，但结果未准确说明【确认】

来源：`hybrid-backend.ts::waitForIdle`、`scenario-executor.ts::semanticOrLayout/scrollFind/executeStep`。[S07][S11]

- Hypium idle 不可用时 Hybrid 用固定延时；场景因 backend 存在该方法仍可记录 `driver_idle`，造成保障等级失真。
- `input_text` 的 layout fallback 没有保留 `append` 的完整语义，也没有统一设置值后的比对。
- Hypium 的 `scrollSearch` 快路径没有传入场景的 `direction/maxSwipes` 预算；不能把 fallback 的循环上限说成所有后端均已遵守。
- `checkpoint` 目前记录名称和步骤号，不是持久化的可安全恢复点。

**修复：** 参数语义不能满足时返回不支持或显式降级，不得静默忽略；动作执行、状态观察和业务验证分别报告。

### F09 / P1：Hypium 修改共享 PATH 和全局配置【确认】

来源：`hypium-backend.ts::prependHdcDirectory/disableHypiumTelemetry`。[S12]

设置选定 HDC 会修改当前进程 PATH；关闭遥测时若配置不是 telemetry:false，会以 `{telemetry:false}` 覆盖配置文件其他字段。关闭遥测本身应该保留，但不应破坏用户其他 Hypium 配置或让不同实例互相影响。

**修复：** 运行环境隔离到驱动进程；使用驱动确实支持的配置机制。必须修改全局文件时，锁定、保留未知字段、原子写入、记录恢复说明，不可臆造不存在的环境变量。

### F10 / P1：多进程共享同一物理设备的互斥需要补证【风险】

来源：Manager 的进程内 Maps、根 README 的双品牌分发。[S01][S13]

当前 Manager 已经实现进程内同设备互斥。Piora 与 XiaoYiHarness、开发实例与安装实例若同时连接同一手机，进程内 Map 本身无法协调。此处应先检查是否另有宿主层仲裁，不能仅凭 Manager 宣布全仓不存在。

**修复：** 增加跨本机实例的设备所有权仲裁与故障恢复测试；它防止合作实例争用，不是防止恶意本地 shell 直接访问 HDC 的安全沙箱。

### F11 / P1：文档并非缺失，而是存在多份互相矛盾的现状说明【确认】

- `README.zh-CN.md` 仍标注 `0.4.41-beta.7`，根包已经 `0.5.2-beta.9`。[S14][S15]
- 主 README 前段描述 SenseVoiceSmall/sherpa-onnx，已知问题仍提本地 Whisper 运行时，需统一。[S13]
- 设备指南仍描述约 1 FPS 本地投屏，当前 hook 已接入视频流、解码与重连；应写清实际模式及降级情况，不保证未经测量的帧率。[S03][S16]
- `AGENTS.md` 架构说明仍写 explicit runtime profile / approval queue；设备指南则写普通会话直接加载、无进程或工具隔离。[S16][S17]
- guide 中旧引用拒绝、控制绑定 generation、驱动清理等陈述，应逐项对应新代码和测试，而不是泛写“已保证”。

### F12 / P1：维护负担集中在长文件和重复协议，而不是三个后端本身【确认/设计判断】

`device-manager.ts` 约 51 KB、`hdc-backend.ts` 约 41 KB，扩展和面板也集中大量职责；同一 action/key/限制在 TypeScript 类型、TypeBox schema、HTTP switch、场景校验和 UI 中重复出现。[S01][S02][S04][S05][S06][S07]

**修复：** 建立单一契约来源，按职责渐进提取。HDC、Hypium、Hybrid 各司其职，不能因为名字相似删除其中一个。

### F13 / P0：打开投屏可能隐式安装手机端服务【确认】

来源：`hdc-backend.ts::ensureMirrorServer/openVideoStream`、`device-manager.ts::openVideoStream`。[S01][S05]

首次打开视频流时会查询 `com.ohos.scrcpy.server`；未安装时执行 `hdc install -r OHScrcpyServer.hap`，随后启动服务并建立 fport。Manager 的打开视频流路径不要求写控制租约。这意味着“查看画面”的初始化可能产生安装和启动的副作用。

**修复：** 将手机端组件初始化从只读订阅中分离，展示来源、版本、权限与安装影响，经用户设备初始化授权后执行；没有批准时可使用已有、可验证的截图路径或明确说明不可用。读取订阅不应该绕过 H06 的安装授权。安装和服务准备按设备/epoch去重，检查已安装版本/协议，不只缓存 serial 是否准备过。

## 2. 能力现状与产品目标

| 能力 | 源码现状 | 改造目标 |
|---|---|---|
| 发现与 HDC 配置 | 已有候选探测、状态和配置 | 首次连接向导、逐步诊断、版本冲突说明、测试报告 |
| UI 观察 | 树/截图、可选独立视觉模型 | 有质量标签的观察、分区/分页、应用窗口上下文、几何代际 |
| 点击/双击/屏幕长按 | 已有 | 新鲜目标校验；长按时长；与实体键保持分开 |
| 滑动/拖拽/甩动 | 已有 | 一致的方向/速度/持续时间语义、坐标转换、滚动预算 |
| 输入/清空 | 已有但后端语义有差别 | set/append/clear 明确、焦点验证、读回校验、Unicode 测试 |
| back/home/recents/enter | 已有 | 保留并统一探测/错误 |
| power/volume/按键保持 | 未接入当前契约 | 只在验证过的后端与机型开放；可中止、可验证 |
| 按住说话 | 无完整复合链路 | 触摸保持 + 就绪检测 + 音频播放 + 松开 + 结果验证 |
| 手机语音识别输入 | 无完整链路 | 真实声学链路优先，测试 App 注入为补充；分别标注覆盖范围 |
| 应用启动/停止/安装/卸载/清数据 | 已有 | 测试应用授权、不可变 HAP 制品、结果校验与回滚边界 |
| 场景等待/断言 | 已有 | 观察未知不等于失败/消失；稳定不等于业务成功 |
| 场景步骤执行 | 已有、最多 64 步 | 可取消、阶段预算、效果不确定时停止、报告可重放但不盲目重执行 |
| 同设备互斥/多设备并发 | 进程内已有 | 保持；增加跨实例、抢占、设备重连栅栏 |
| 投屏/录屏/日志 | 已有 | 统一资源所有权、可恢复断流、背压、隐私、可导出支持包 |
| DevEco 代码检查 | 已有独立 harmony-check 模块 | 不误称 IDE Problems 全量结果；区别 CLI 与 IDE 来源 |

## 3. 目标架构：保留外观入口，逐步替换内部责任

第一阶段不改仓库顶层，不拆成几十个 npm 包。`device-manager.ts` 和 `extensions/piora-harmony.ts` 保留兼容入口。下列结构是目标结构，按任务建立，禁止先建空目录和 TODO：

```text
lib/harmony/
  types.ts                         旧类型兼容导出
  device-manager.ts                兼容 facade；不再直接承担全部资源生命周期
  hdc-backend.ts                    初期保留入口，之后按职责委托
  hypium-backend.ts                 保留适配器入口
  hybrid-backend.ts                 仅负责按能力选路，不吞掉语义差异
  contracts/
    actions.ts                     单一动作目录、discriminated schema、边界规则
    capabilities.ts                动作级能力和版本/机型限制
    observations.ts                观察质量、窗口上下文、几何引用
    receipts.ts                    执行、效果、验证与恢复策略
  runtime/
    device-session.ts              单设备会话和连接 epoch
    operation-queue.ts             同设备有界队列及优先控制通道
    lease-registry.ts              运行身份、租约、撤销、跨实例所有权
    resource-scope.ts              键、触摸、音频、录屏、fport 的统一清理
    action-dispatcher.ts            鉴权→预检→执行→验证→收据
    worker-client.ts               驱动进程 IPC 客户端
    worker-entry.ts                独立驱动进程入口（实际构建后才引入）
  observation/
    snapshot-store.ts              引用有效期和质量
    geometry.ts                    帧/裁剪/旋转/原生坐标变换
    target-resolver.ts             唯一目标、窗口约束、歧义拒绝
    postconditions.ts              业务条件验证
  policy/
    policy-engine.ts               测试设备/应用授权和风险分级
    approval-store.ts              一次性、短时、绑定动作的许可
  input/
    key-catalog.ts                 受控符号键映射
    key-hold.ts                    持续按键、取消与释放确认
    text-input.ts                  set/append/clear 与读回
  audio/
    audio-session.ts               生命周期和路线选择
    acoustic-provider.ts           宿主受控输出→真实手机麦克风
    app-test-provider.ts           自有 debug 测试 App PCM 注入
    audio-assets.ts                本地音频校验、制品引用与生命周期
  media/                           逐步提取投屏、录屏、临时资源清理
  diagnostics/                     doctor、结构化证据、脱敏支持包

extensions/
  piora-harmony.ts                  保留入口，注册工具并转发服务
  harmony/                         工具 schema/输出适配；不拥有物理设备令牌

components/workspace/harmony/
  DeviceConnectionWizard.tsx
  DeviceToolbar.tsx
  DeviceViewport.tsx
  CapabilityPanel.tsx
  RunTimeline.tsx
  ApprovalDialog.tsx
  AudioTestPanel.tsx
  DiagnosticsPanel.tsx

# 保留旧 HarmonyPanel.tsx，作为组合入口，避免同时改所有 import。
```

### 3.1 三层不能混淆

- **传输与设备后端**：只执行结构化操作，报告是否已发送/是否得到确认，不自行判断业务成功。
- **设备运行时**：拥有队列、租约、授权、资源和执行收据；Agent、HTTP、手动 UI 共用它。
- **Agent/界面适配层**：表达意图、展示结果，不保存独立的设备真相、不复制动作校验逻辑。

驱动进程隔离针对崩溃、阻塞、PATH 和依赖环境，不自动构成安全沙箱。当前普通 Agent 还拥有编码工具；若同一 OS 用户能通过 shell 直接运行 HDC，单独的审批服务无法保证所有旁路均受控。产品须明确“可信本地开发环境”边界；更严格场景需要独立 OS 权限/隔离执行环境，不能只靠工具描述实现。

### 3.2 建议的数据契约（名称可按仓库风格调整，语义不可删减）

```ts
type CapabilityStatus = 'supported' | 'unsupported' | 'unknown' | 'degraded';
interface ActionCapability {
  action: string;
  provider: 'hypium' | 'hdc-uitest' | 'uinput' | 'acoustic' | 'app-test';
  status: CapabilityStatus;
  reasonCode?: string;
  constraints: Record<string, unknown>;
  evidence: 'version-inferred' | 'help-probed' | 'non-destructive-probed' | 'hardware-verified';
  checkedAt: string;
}
interface ObservationIdentity {
  observationId: string;
  deviceEpoch: number;
  geometryId: string;
  capturedAt: string;
  treeStatus: 'valid' | 'partial' | 'unavailable' | 'parse-error';
  scopeComplete: boolean;
  appId?: string;
  windowId?: string;
}
interface ActionReceipt {
  operationId: string;
  deviceEpoch: number;
  dispatch: 'not-sent' | 'sent' | 'acknowledged';
  effect: 'confirmed' | 'not-observed' | 'unknown';
  verification: 'passed' | 'failed' | 'not-requested' | 'unavailable';
  provider: string;
  strategy: string;
  retry: 'safe-after-preflight' | 'observe-first' | 'forbidden';
  beforeObservationId?: string;
  afterObservationId?: string;
  cleanup: 'complete' | 'pending' | 'uncertain';
}
```

“命令返回成功”“界面发生变化”“业务目标已达成”必须分开。没有后置条件时，不能把整个流程描述为业务验证通过。正常颜色/动画变化不等于提交成功；屏幕稳定也不等于请求完成。

### 3.3 执行管线

`解析 schema → 校验身份/设备/授权 → 校验 epoch 与观察 → 选择满足参数语义的 provider → 登记资源与 operationId → 发出操作 → 等待有界结果 → 检查后置条件 → 清理 → 记录脱敏收据`

在进入每个真实后端写操作之前再检查执行栅栏。校验完再排队并不足够，因为排队过程中设备、授权、窗口和取消状态都可能改变。

重试原则：连接前失败可以安全选择其他 provider；操作可能已发送时，不自动换后端重复点击或输入。恢复后先观察。仅靠桌面端 operationId 不能保证设备副作用 exactly-once；进程崩溃后无法确定的写操作必须报告 unknown。

## 4. 电源键长按：实现路线和不可省略的约束

官方 OpenHarmony 文档列出 `uitest uiInput keyEvent` 的 Power 支持，但该接口说明不能证明它等于持续按住。官方 `uinput` 列出键盘 down/up/interval/long_press；`-l` 的文档范围为 3000–15000 ms，`-r` 是重复输入，不是同一种长按。[O01][O02]

### 4.1 应提供的语义

```json
{
  "action": "key_hold",
  "key": "power",
  "durationMs": 1200,
  "expected": { "kind": "ui_condition", "profileConditionId": "assistant_ready" }
}
```

以上是目标 API 示例，**1200 ms 不是所有手机的有效值，也不是 `uinput -l` 的合法示例**。服务端必须验证当前机型和 provider 的持续时间范围；不支持就拒绝，不得静默改成 3000 ms。短于 `-l` 最小值的实现，只有在目标设备验证了 down/interval/up 链路后才能开放。

高层另提供 `open_assistant`，它根据已验证的设备配置选择屏幕入口或实体键路径。不能保证每款手机长按电源都唤醒同一助手。

### 4.2 执行要求

- 先无副作用地读取版本和 help，再在测试设备、用户可见的校准流程中验证实体键行为。
- 符号键映射来自目标 SDK/系统文档，不照搬 Android keycode；Agent 不得传任意整数键码或任意 shell。
- API 可以采用驱动支持的 bounded hold 或单设备命令序列；必须验证实际保持和释放，而不是循环发送短按。
- `key_down/key_up` 不作为长期悬空的普通 Agent 工具暴露。高层 hold 是一次有开始、结束和最大期限的复合动作。
- 取消、run 结束、超时、驱动重置、USB 断开都进入清理。优先依赖已验证的设备侧有界释放，并辅以宿主释放清理。
- USB 断开时不能保证宿主发出的 key-up 到达。无法确认释放时标记 `cleanup:uncertain`，隔离新的危险动作并提示人工检查，不得伪报“已全部松开”。
- 默认不开放恢复出厂、强制关机组合、紧急呼叫组合和任意超长电源保持。用途是授权测试，不是绕过锁屏或系统保护。
- 测试记录必须包含设备、系统版本、provider、请求持续时间、实际可观察结果和释放状态。

## 5. 语音输入：必须拆成三条不同的产品能力

### 5.1 A 路线：用户对电脑说话，转成文字填写到手机

复用现有桌面本地转写，再经 `set_text` 写入已确认的手机控件。界面名称建议“语音转文字填写”，报告覆盖范围是文字输入，不是手机麦克风、手机 ASR 或小艺端到端验证。

### 5.2 B 路线：让真实手机听到声音——第一版必须交付的端到端路线

使用本地已验证 WAV/PCM 语料，或明确选择的 TTS 生成音频，通过已选择和校准的电脑音频输出设备/外部声学夹具，进入手机真实麦克风。

流程：`观察目标 → 打开语音入口或保持按住说话 → 等待目标进入监听态 → 播放音频 → 等待播放结束/尾部静音 → 释放按住状态 → 等待识别结果 → 验证目标 App 的文本或意图结果`。

- 播放音频不是 ASR 成功；必须验证目标 App 的实际输出。
- 录音就绪来自可验证 UI/自有测试回调，不以固定 sleep 冒充就绪。
- 多手机共享同一扬声器存在串音：声学播放资源需要独立锁；并行需隔音/独立物理音频通路。
- 本地播放器的声音不能假定自动变成另一 App 的麦克风数据。回声消除、输入路由、设备音量都要实测。
- 允许 TTS 是额外选项，不把联网语音服务设为默认必需；每次外传音频/文本需要明确数据流说明。
- 支持 push-to-talk；触摸保持、音频播放、观察必须由同一个复合动作统一管理，不能由三次互不关联的工具调用拼起来。
- USB 音频/蓝牙/模拟器虚拟音频只能作为单独 provider，并标记对应路由验证结果，不宣称通用可用。

### 5.3 C 路线：自有测试 App 的音频注入

在自有 debug/test App 中抽象 `AudioInputSource`，分别支持真实麦克风和测试 PCM 数据源；只在测试构建中开放本地、带会话凭证的注入入口。通过构建检查证明生产 HAP 不含测试入口。

此路线可稳定复现识别算法与业务逻辑，但不覆盖手机麦克风、声学环境、系统输入路由或任意第三方 App。官方 AudioCapturer 是音频采集接口，其存在不证明可以向任意第三方应用麦克风注入数据。[O03]

### 5.4 语音工具建议

默认面向 Agent 提供 `harmony_speak` 或统一 `harmony_act` 的 `voice_input` 动作。参数包含 `audioAssetId`、输入路线、目标监听就绪条件、是否 push-to-talk、结果条件、最大总时长。不要让模型每次操作都手工管理 PCM 采样格式、播放设备文件路径和 touch-up。

结果包含实际 provider、音频 hash、播放/监听/识别时间点、目标识别摘要、验证结论、清理状态。默认不在普通审计日志里写完整语料、识别私密内容或原始音频。

## 6. Codex 实施任务清单

**下列拟新增路径、命令和测试名都是实施要求，不表示基线已经存在。** 每个任务单独形成可审查变更；若一个任务超出可审查范围，可拆分为 a/b 子任务，但不得把验收项移到没有依赖关系的“以后再做”。

### H00 — 锁定基线与全仓依赖清单

**优先级：P0；依赖：无。**

读取完整 `AGENTS.md` 与涉及子目录约定。执行 `git status --short`、`git fetch origin`、`git rev-parse HEAD`，保留用户未提交修改。当前 main 若已前进，比较审计 SHA 与工作基线，逐条重新定位 F01–F13，标记仍存在、已修复或发生变化；不得为了符合报告重新引入旧代码。

建立 `docs/audits/harmony-baseline-<date>.md` 与机器可读清单：文件路径、运行入口、静态引用、动态引用、构建引用、测试引用、发布引用、当前事实和疑点。检查 `bin/`、`branding/`、`desktop/`、`services/`、两个官网目录、`scripts/`、`public/`、`docs/` 和所有 workflow，而不只是 TS import。

基线运行：`npm ci`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run verify:hygiene`、`npm run licenses:check`、`npm run perf:check`。分别记录命令、退出码、环境缺失、原有失败与新增失败。不要一开始升级依赖或删除 lockfile。

**验收：** 可以知道后续失败是否本来存在；未运行、跳过和通过明确区分；没有修改用户本地数据；没有本地发布打包或推送标签。

### H01 — 建立可控制故障的设备测试替身

**优先级：P0；依赖：H00。**

修改/扩展现有 `lib/harmony-device-manager.test.mjs`、`lib/harmony-scenario-executor.test.mjs`、`lib/harmony-hybrid-backend.test.mjs`；新增共用 fixture，不复制整套生产后端。

测试替身可控制：连接 epoch、有效/无效 UI 树、分辨率和旋转、命令实际执行但 ACK 丢失、RPC 连接迟到、设备拔插、慢 stopRecording、永不结束请求、音频播放取消。使用可控时钟，避免每例真实等待几十秒。

先写能暴露现有行为的回归：空树旧坐标点击；缺失树下负向断言；在途动作时撤销租约；两个 session 竞争一台手机；两台手机互不阻塞；编码会话在 HDC 缺失时仍运行。

**验收：** 关键用例实际调用函数和观察派发次数/顺序，不能仅用正则断言源码含某字符串。失败必须指向待修复问题，而非 fixture 不可用。

### H02 — 修复观察有效性与旧引用点击

**优先级：P0；依赖：H01。**

修改 `device-manager.ts::captureSnapshotNow/tapRef`、`types.ts`、`ui-tree.ts` 与 `scenario-executor.ts::waitFor`；提取 `observation/snapshot-store.ts` 和 `target-resolver.ts`。

快照新增观察质量、完整范围、采集时间、窗口上下文（不能查询时显式 unknown）。语义 ref 绑定 epoch、观察标识和目标身份；设置可配置但有上界的引用年龄。禁止 `captured_bounds_fallback` 自动写入。弱匹配仅能用于生成候选，不可自动确认高风险点击；匹配重复 id 时结合祖先、窗口和状态，否则拒绝。

区分“有效空集合”和“观察失败”。`exists:false` 必须基于有效且覆盖相关窗口的观察。设备切换、断开、解析失败和截图禁止均不得被解释为目标业务控件消失。

**验收：** 空树/陈旧引用/重复节点/遮挡的错误路径后端 tap 调用次数为 0；Canvas 仍可经单独视觉动作进入后续 H04 流程；可见有效状态下正常语义点击不退化。

### H03 — 统一租约撤销、单设备停止与资源生命周期

**优先级：P0；依赖：H01。**

修改 `device-manager.ts`，提取 `runtime/lease-registry.ts`、`operation-queue.ts`、`resource-scope.ts`。租约绑定 `owner/sessionId/runId/deviceEpoch/leaseEpoch`。每个 in-flight operation 登记 owner、serial、leaseEpoch 与资源。

新增单一 `revokeLease(reason)` 流程：同步禁止旧票据派发、取消对应排队和在途操作、作废相关观察，再处理资源。设置真实到期调度或等价 watchdog，不只在下次调用时扫过期。更换连接 epoch 后旧租约不可续期。

急停分单设备和全局两个动作；停止入口优先于普通 FIFO，不等待录屏文件下载才显示已停止接单。设置 `stopping/recovering` admission 状态，清理完成前新写操作被拒绝。资源清理有最大期限、可重试且幂等；owner A 撤销不能取消同进程 B 的另一台设备任务。

**验收：** 撤销后的新后端写操作为 0；TTL 到期不依赖下一次 API 请求；旧连接票据不能控制重连手机；慢录屏不会阻塞停止接单；切换 UI session 不触发无关 owner 的停止。

### H04 — 建立坐标和画面几何协议

**优先级：P0；依赖：H01、H02。**

修改 `types.ts`、`hooks/useHarmonyLiveFrame.ts`、`HarmonyPanel.tsx::imagePoint`、`app/api/harmony/action/route.ts`、HDC 镜像协商；新增 `observation/geometry.ts`。

分离 CSS 坐标、视频编码坐标、截图坐标、设备原生输入坐标。服务端发行 `geometryId`，包含 native dimensions、frame dimensions、crop、rotation、displayId 和 epoch；Agent/前端传坐标所属空间与 geometryId，由服务端转换。UI 树 bounds 也要标明坐标空间。

无法确定原生输入几何时，禁用可能错误的坐标写操作并给出原因，继续保留可验证的语义操作。不要只凭视频宽高猜物理屏幕。旋转、折叠和视频重配置使旧 geometryId 失效。

**验收：** 单元测试覆盖 1440→1080、其他非等比裁剪、90/180/270 度、DPI 缩放、letterbox、坐标越界、旧 geometryId；浏览器测试验证点击区域与服务端收到的原生点一致；至少一台不同视频/输入分辨率的手机实测。

### H05 — 单一动作目录与 schema 生成

**优先级：P1；依赖：H02、H03、H04。**

新增 `contracts/actions.ts/capabilities.ts/receipts.ts/observations.ts`。使用仓库已有可用的校验方案，避免无必要替换依赖。让动作输入采用 discriminated union，而不是 action 加几十个全 Optional 字段，再 `as unknown as` 强转。

每个动作条目定义：输入 schema、能力要求、参数约束、风险类别、可重试分类、清理需求、默认结果说明。由该条目生成/适配 Agent schema、HTTP 校验、场景校验、UI 能力说明和 docs JSON；业务模块不得反向依赖 Agent 扩展注册器。

保持旧 `harmony_*` 名称与有效参数兼容；新增协议版本。统一输入长度、duration 范围和 key 枚举；不存在的字段拒绝或进入明确兼容层，不能在三个入口下有三套含义。

**验收：** 对同一非法参数，Agent、HTTP、scenario 返回一致错误类别；全部支持动作都有执行器和文档映射；无运行时 handler 的能力不能显示为支持；旧用户场景样例回归通过。

### H06 — 真正的设备授权和破坏性动作审批

**优先级：P0/P1；依赖：H03、H05。**

**H06a 紧急防线不等待 H05：** 在现有集中执行路径先拒绝没有明确授权的卸载、清数据和安装（含投屏初始化安装），保留已有授权的测试流程；这应与 H02/H03 同批交付。H06b 再依赖 H05 完成以下长期方案。

新增 `policy/policy-engine.ts/approval-store.ts`，修改 Manager/dispatcher、Agent 获取控制路径及 `app/api/harmony/approval/route.ts`。所有入口汇入相同授权层，不能只在 UI 按钮点击时检查。

建议三种范围：仅观察；限定设备/应用的测试控制；一次性高风险操作。用户可批准本任务在测试应用内的普通点击和输入，不重复打扰。安装、卸载、清数据、改变系统状态、启动录制和指定语音路线按明确策略处理。一般 App 中无法可靠判断的提交、发送、支付等行为不能仅靠按钮关键词判定安全。

审批绑定 canonical action hash、设备 epoch、owner/run、目标 App、有效期与单次消费。HAP 先导入受控制品区并计算 hash；批准后替换同路径文件必须拒绝。权限请求 UI 只负责展示和确认，不把可重复使用 bearer token交给模型。

**验收：** 过期/重放/换设备/换 run/改参数/换 HAP 的批准均失效；未经授权的清数据不会到达后端；低风险已授权的正常流程不逐点击弹窗。旧 metadata-only 接口在迁移完成后删除或明确废弃，不保留假的安全承诺。

### H07 — 逐设备能力探测与 doctor

**优先级：P1；依赖：H05。**

修改 `runtime.ts`、`hdc-backend.ts`、`hybrid-backend.ts`、`hypium-backend.ts`、diagnostics 接口。新增只读 doctor 和动作级能力矩阵。

探测项目：HDC 绝对路径/版本/冲突候选、设备授权、OS/API/UiTest、Hypium 冷却状态、屏幕/树可读性、安装能力、视频服务、已注册音频路线和 uinput 可用命令。危险能力只能通过 help 推断为 candidate，不能在自动启动时通过关机或清数据去探测。

能力的缓存键包含设备 epoch、SDK/driver 指纹；运行时失败可降低状态，显式重新探测恢复。未知、永久不支持、缺权限、暂时断线必须给不同原因和恢复动作。新增 `harmony_get_capabilities` 与 UI 同源输出。

**验收：** 版本号支持但权限不足不报可用；Hypium 可用与 CLI 不可用能准确表达；安装 HDC 后无需重建普通 Agent 会话即可重新检测；无设备不产生启动失败。

### H08 — 统一文本、等待、滚动和执行结果语义

**优先级：P1；依赖：H05、H07。**

修改 `scenario-executor.ts`、Hybrid/Hypium 后端、Agent 的 `verifiedActionResult`。新增 `input/text-input.ts` 和 `observation/postconditions.ts`。

文本明确 set、append、clear、提交四个不同动作；写入前验证目标及焦点，写入后可读时比对。provider 不支持指定语义必须拒绝，不静默降级。中文、emoji、引号、反引号、美元符号、多行和尾部换行保留原有临时文件安全传输；不得退回拼接用户文本的 shell。

等待分别报告 semantic condition、driver idle、visual stable、bounded delay。不得把固定 delay 标成 driver idle。负向断言沿用 H02 的质量要求。滚动预算包括次数、方向、总时长和累计范围；Hypium 快路径无法遵守时改用可控的逐步滚动。

所有动作输出 H05 收据；保留结构化错误 code/details/retry/dispatchState，不在扩展层压扁成丢失信息的普通字符串。

**验收：** 同一场景在可支持的两个后端语义等价；append/set 不互换；一条最多 3 次滚动的请求不能偷偷进入无上限 scrollSearch；已经发出的 RPC 超时不会被第二后端重放；延时不是业务验证通过。

### H09 — 驱动进程隔离和跨实例设备仲裁

**优先级：P1；依赖：H03、H05、H06、H08。**

先定义 `worker-client/worker-entry` IPC 协议与实际构建产物路径，再迁移驱动。主服务保留任务身份和用户策略，驱动进程只接受已验证的结构化请求；IPC 包含 requestId、epoch、截止时间、取消、结果和协议版本，不接受任意脚本。

逐步迁出 HDC/Hypium/视频解码辅助等可能阻塞与修改环境的部分；按设备管理生命周期，是否一设备一子进程以资源测量决定，第一版不必引入网络微服务。复用项目已有桌面构建规范，确保 dev 与 packaged runtime 的 worker 入口都真实存在，不通过源码绝对路径启动发布包。

跨实例仲裁先检查已有宿主机制；缺失时实现本机每物理设备唯一控制所有者。可复用已经存在的文件锁依赖，但锁文件应放在两个品牌共同认可、受本机权限保护的运行目录，不能各自品牌各锁一份。记录进程身份、启动实例标识和心跳，不能只凭过期时间盗取仍存活实例的锁。

Hypium PATH 改为子进程级；关闭遥测保留，配置修改保留未知字段并原子写入。驱动崩溃只使该设备进入 recovering，不终止 Pi Session；不自动重放不确定动作。

**验收：** 杀掉驱动进程，聊天/另一设备仍可用；Piora+XiaoYiHarness+开发实例竞争同手机仅一个持有控制权；发布包脱离源码目录仍能启动/停止 worker；没有残留共享 PATH 污染和配置字段丢失。

### H10 — 实体键和电源键长按

**优先级：P1，用户明确需求；依赖：H03、H05、H07、H09。**

新增 `input/key-catalog.ts/key-hold.ts` 和经过探测的 `uinput` 适配器；扩展 ActionContract，不在每个 switch 手工复制一次。保留旧四键，按已验证能力增加 power、音量等符号键。

实施第 4 节全部约束。先验证低风险键序列，再经显式校准验证 power 行为。记录长按与重复按键的差异、provider 的时间限制、取消时是否实际释放。不得为了让“1200 ms”参数看起来支持而静默使用 3000 ms。

增加一次高层 `key_hold` 收据以及 `open_assistant` profile，不在 Agent 上暴露无限期 key_down。没有可用 provider 时明确返回原因和可行替代入口，不把“已注册工具”算完成。

**验收：** 行为测试证明 down 一次、hold、up 一次；取消和超时清理；目标实机有视频/日志证据证明达到期望界面并释放。无实机时仅可标软件测试完成，硬件验收 blocked。

### H11 — 持续触摸与复杂手势

**优先级：P1；依赖：H03、H04、H05、H07。**

增加受控 `touch_hold` 和复合动作内部 touch down/up 能力，供按住说话、拖动滑块等使用。gesture 参数区分 holdDuration、moveDuration、speed；不把不同 provider 的速度与毫秒强行视为同一值。

滚动、拖拽、pinch/multi-touch 等按明确可用能力开放；优先交付按住说话必须的单点保持，不为“全能”一次接入所有外设。每次保持绑定设备和 geometryId，旋转或焦点改变要停止或重新规划。

**验收：** 按住后不意外发成 click；复合动作取消一定进入释放流程；新帧几何变化后旧触点不会继续错误移动；对不具备安全释放能力的设备不开放持续保持。

### H12 — 音频制品与真实声学 provider

**优先级：P1，用户明确需求；依赖：H03、H06、H07、H09。**

新增 `audio/audio-assets.ts/acoustic-provider.ts/audio-session.ts`，复用既有宿主音频设施但不把聊天录音/转写直接当设备语音实现。首版以本地小型已授权 WAV 语料工作，TTS 为可选扩展。

校验文件实际格式、大小、时长、采样率/声道范围，创建 immutable assetId/hash。用户显式选择音频输出；完成声音可达性、音量和目标设备监听的校准。播放时资源锁包含输出通路，避免两台手机共享扬声器串音。

音频可停止，任务完成/取消时回收；没有许可不能启动采集或外传。存储目录沿用安全制品接口，防路径穿越、符号链接绕过和任意 URL 下载。

**验收：** 离线语料可以从指定输出设备完整播放并可中止；音频不存在/被替换/过长会在派发前拒绝；声学路线自检失败不会宣称手机正在听；日志不含音频字节或完整私密文本。

### H13 — 端到端语音与按住说话场景

**优先级：P1；依赖：H02、H08、H11、H12。**

新增 `voice_input` 复合动作与简单的 `harmony_speak` 入口，实施第 5 节 B 路线。前置条件必须包括当前设备、目标 App/窗口和录音就绪条件。支持点击开启监听及 push-to-talk 两种方式；全程由单一 lease/resource scope 管理，不允许孤立工具调用遗留按压。

一条请求完成“进入监听→播放→释放→验证”，按阶段返回时间和错误。只有实际识别结果或目标意图的后置条件通过，才报告端到端通过；显示声波或播放器结束均不足以通过。

自有测试 App 使用确定性样本，第三方/小艺路径采用设备 profile 与可验证结果；手机/版本不匹配时提示校准，不猜 package、控件和唤醒时长。

**验收：** 标准语料、无音频、错误语料、延迟就绪、失焦、播放中取消、断线和多手机串音测试；包括一次真实手机识别结果的 evidence bundle。自动发送消息、打电话等外部副作用不能作为无确认的演示默认步骤。

### H14 — 自有 App 的测试音频桥接（独立增强，不冒充通用注入）

**优先级：P2；依赖：H05、H06、H12。**

建立最小 Harmony test fixture App；若仓库尚无该 App，放独立测试目录并明确构建和签名要求。抽象 AudioInputSource，支持麦克风及 PCM 测试输入。连接认证绑定会话、设备和短时 token；禁止公网监听。

注入入口仅存在 test/debug 构建，生产构建自动检查移除。报告 provider `app-test` 与覆盖边界。模拟器或系统级授权音频注入作为后续 provider，必须先出官方接口、权限及目标版本的验证报告，不能通过普通 AudioCapturer 倒推出支持。

**验收：** 同一音频可重复得到可比较结果；生产 HAP 无测试入口；拿其他设备/run 的 token 无法注入；测试报告清楚写“没有覆盖真实麦克风”。H13 声学路线不依赖此任务完成。

### H15 — Agent 工具可发现性与轻量交互

**优先级：P1；依赖：H05、H07、H08。**

拆分 `extensions/piora-harmony.ts`，保留兼容入口和旧工具名。内部仅消费统一 dispatcher，不另持一套控制状态。默认文案推荐：discover/capabilities → observe → act/run_scenario → verify → report。

补齐按应用名称/包标识查询、可用启动 ability、选择设备的明确解析。只有一个符合条件设备时自动选择；多个设备有歧义时不盲选。设备选择属于任务绑定，不跟随用户临时切换的 UI 下拉框漂移。

观察支持过滤、区域、分页和必要的祖先上下文。发现截断时允许继续获取，不强迫每步输出全部节点或截图。保留 UI 文本/日志/视觉结果为不可信数据的边界，截断后也不丢失关闭标记。降低默认工具描述和观察体积，但通过真实调用指标证明，不能仅按工具个数猜 token 收益。

**验收：** Agent 能在不记包名/键码/HDC 命令的情况下完成标准测试任务；支持误导性屏幕文本的 prompt-injection 回归；旧工具调用仍可工作；Agent 不接收可复用租约或审批令牌。

### H16 — 设备工作台：连接、控制、语音、结果一体化

**优先级：P1；依赖：H04、H06、H07、H15；语音页依赖 H13。**

保留 `HarmonyPanel.tsx` 外部 Props，逐步提取第 3 节组件。前端类型从共享契约生成，不继续手写另一份设备模型。保留已有错误边界、日志和代码检查入口。

首次使用提供“检测 HDC→手机授权→读屏自检→安全点击校准→配置测试应用/范围”向导；错误消息说明原因、下一步和诊断编号。日常页默认只呈现设备、画面、当前控制者、能力、执行进度和停止按钮，高级 SDK/协议设置收起。

增加应用搜索与最近测试应用，不要求用户日常手输 bundle/ability。按键显示真实支持状态；长按有持续时间和释放状态；语音页可预览选定语料、输出通路和目标监听状态。

人工接管走设备级受控流程；UI 切到另一台手机不取消旧 Agent。状态展示区分“正在连接/未授权/可观察/可控制/被占用/恢复中/清理不确定”，禁止一律用离线或失败概括。

**验收：** 保留现有 `components/HarmonyPanel.browser.test.mjs` 并增加连接向导、缩放点击、语音取消、人工接管、多设备和 stale state 测试；从安装后首次连接到首次成功场景不要求手敲 HDC 命令。

### H17 — 场景执行记录、条件恢复与模板

**优先级：P1；依赖：H03、H05、H08、H15。**

扩展场景执行器的步骤结果、实时进度、操作收据和失败证据；继续保留最多 64 步及全场景有界执行。未执行的步骤明确 `not-run`，不要只返回已执行数组让 Agent 猜测剩余状态。

checkpoint 升级为持久证据：记录流程版本、步骤、已验证前置条件、设备 epoch、制品 hash 和恢复规则。默认恢复先重新验证现场；只能重跑明确安全的步骤，禁止自动重放发送、清数据、安装等不确定副作用。

提供至少 6 个使用统一 schema 的小场景：启动应用并验证；中文输入；长列表查找；横竖屏几何验证；按住说话；断连后安全恢复。模板与自动测试使用同一份 JSON，文档不能另外手写一份漂移版本。

**验收：** 崩溃后的任务显示 interrupted/unknown 而非永久 running；恢复不会重复已发送动作；报告可读出为什么失败、哪些动作已发生、哪些未执行及下一步允许操作。

### H18 — 诊断、脱敏证据、媒体与临时资源

**优先级：P1；依赖：H03、H07、H09、H17。**

将 HDC 视频、录屏、日志和临时文件逐步提取，统一归属到 serial/owner/operationId/resource scope。所有清理只针对自己创建的远端路径、fport 和会话，不使用影响全设备的进程/文件清理捷径。

doctor 导出版本、能力、队列、lease 元数据、驱动状态和时延。默认脱敏序列号、用户路径、日志敏感字段；截图、UI 树、录音是否进入支持包由用户选择。设置容量、保留期限和清理策略，不无限积累文件。

流资源有取消、背压、重连和监听者引用计数；面板关闭只停止其订阅，不杀掉 Agent 所有资源。发布包重启后可发现自己遗留但未完成的记录，标 unknown 并提供受控清理。

**验收：** 多次开关面板/连接/录屏后进程、fport、监听器和临时文件回到合理基线；支持包可离线排障但没有模型密钥、完整私聊文本或默认音频内容；USB 拔出不会让诊断导出永久等待。

### H19 — 鸿蒙开发到实机验证的完整反馈链

**优先级：P2；依赖：H07、H15、H17。**

先完整检查已有 `lib/harmony/check-runtime.ts/check-config.ts/check-types.ts`、`HarmonyCheckPanel` 及 `test:harmony-check`，保留现有能力而不是重新造同名模块。

让用户能运行“当前工程检查→选择构建产物→授权安装→启动→执行场景→按设备/进程过滤日志→定位出错文件”。所有诊断输出注明来源、工程根、文件相对路径和更新时间，防止把旧工程结果归给新工程。

CLI、语言服务、构建错误和正在运行 DevEco 的 Problems 面板是不同来源。没有 IDE 插件连接时不能声称读取到 Problems；如扩展 IDE bridge，独立定义协议、认证、事件更新与缺失时降级，不阻塞已有 CLI 工作流。

**验收：** 一个测试工程从代码错误到修复、安装、场景验证有可追踪链路；安装必须使用批准的产物 hash；不覆盖用户源码或改签名配置以便“自动通过”。

### H20 — 仓库清理与死代码验证

**优先级：P2；依赖：H00、H05；移除旧实现需对应迁移任务完成。**

按第 7 节清单执行。扫描静态/动态引用、fs 路径字符串、Electron extraResources/asarUnpack、Next standalone tracing、脚本、workflow、扩展资源发现、官网、文档链接和发布附件。建立 `docs/audits/repository-cleanup-manifest.json`（拟新增）：每项含用途、引用、决定、替代位置和验证命令。

只删除经证据确认的无入口/无依赖/无兼容用途文件。迁移大文件时先提取、保留薄 facade 和等价测试，再删除旧内部代码。历史文档先归档而不是抹去。生成资源有唯一源文件和可重复生成命令后再考虑取消跟踪。

**验收：** 每个删除项都能回答“为何不用、谁原来使用、怎样证明无回归”；两个品牌、两个官网、桌面发布和许可证检查通过；不以清理为名删除日志/测试/审核证据。

### H21 — README、AGENTS 和设备文档统一

**优先级：P1；依赖：H05、H07、H20；随各功能任务持续同步。**

按第 8 节修改。消除根 README 的语音运行时冲突；README.zh-CN 变为不带复制版本号的跳转页；修复 AGENTS 的旧 profile/approval 架构陈述；当前设备指南与历史设计分开。

动作能力和参数表由注册表生成，静态兼容矩阵只填写有实机证据的型号/OS/SDK/driver 组合。解释“普通会话仍具有编码工具”“设备控制不是沙箱”“电脑转写不等于手机语音”“keyEvent 不等于 key hold”。

新增 docs 校验命令，检查死链接、失效示例、被删除动作、版本漂移、错误路径。README 保持用户入口，不把所有内部历史方案继续塞到首页。

**验收：** 新用户照说明可完成真实安装/连接/第一场景；示例 JSON 由 schema 校验并有 fixture 对应；每个支持声明有代码/测试/硬件证据或明确 unsupported 标签。

### H22 — 软件门禁、真机门禁和发布交付

**优先级：P1；依赖：H02–H18、H21 中拟发布的能力完成。**

在现有 `.github/workflows/ci.yml` 与 `test-suite.yml` 上扩展，不重复新建一套并行测试框架，不破坏已有 required check 名称。保留 Windows/Linux 测试分片、性能、许可证、hygiene 和 packaged runtime 验证。[S18][S19]

增加 capability/action-schema、故障注入、UI、跨进程、worker 打包回归。实机 job 必须在带标签的受控设备环境执行，输出矩阵、测试次数、失败、音频路径及证据 hash。没有手机时明确 `not-run/blocked`，不能 skipped 但将支持状态标绿色。

发布仅由 GitHub Actions 执行，遵守 AGENTS：版本/lockfile/README/CHANGELOG/许可证同步；不移动已发布标签、不在本地生成发布安装包。补充签名/校验、外部驱动与模型来源、完整性与升级兼容策略；不在本次代码计划中擅自购买证书、开云资源或上传隐私日志。

**验收：** 第 9 节目标逐项有证据；软件验证和硬件验证分别展示。只能对通过目标矩阵的机型宣称可商用，未知机型保留试验标签。发布撤回只禁用新能力，不恢复 F01 的危险兜底。

### 6.1 推荐合并顺序与协作边界

```text
H00 → H01
        ├→ H02 → H04 ─┐
        └→ H03 ───────┼→ H05 → H06/H07 → H08 → H09
                      │                    ├→ H10 实体按键
                      │                    ├→ H11 触摸保持
                      │                    └→ H12 音频 → H13 语音闭环
                      └────────────────────────→ H15 → H16/H17/H18
H14、H19 为独立增强；H20 清理按迁移完成情况开展；H21 持续同步；H22 发布收口。
```

并行建议不超过三个共享接口分支：契约与运行时负责人；输入/音频适配负责人；UI/文档/测试负责人。H05 契约合并前，不让多个 Codex 工作树同时各自改 `types.ts`、扩展巨大 schema 和 scenario union。清理目录不要与功能迁移同时大范围改路径。

### 6.2 每项任务统一交付格式

提交说明必须包含：任务 ID；修复的可观察问题；修改路径；兼容性和配置变化；测试命令、结果及缺失环境；硬件证据状态；剩余限制；回退方法。每次提交更新 CHANGELOG 的 Unreleased。提交/推送前按 AGENTS fetch 并确认分支没有前进。

不能以“重构完成、理论可用”验收。测试失败时不得删除测试、增大超时掩盖问题，或返回假成功来跑绿 CI。没有实际运行的结果写“未运行”，没有实体设备的结果写“待实机验证”。

## 7. 哪些目录/文件多余：处理清单与删除证据

**结论：没有足够证据支持直接删除整个业务目录。优先清理重复真相、陈旧设计和迁移后残留，而不是根据目录名称删功能。**

### 7.1 应归档、压缩或明确失效范围

| 现有路径 | 处理建议 | 不应采取的做法 |
|---|---|---|
| `OPTIMIZATION_PROGRESS.md` | 从根目录迁移到既有 `docs/archive/` 下的有日期区域；根 docs 索引保留链接 | 作为当前实施进度持续混用 |
| `PERFORMANCE_REVIEW.md` | 归档为当时基线审查；把仍适用的预算转入现行性能文档/测试 | 删除之后连性能约束也丢掉 |
| `PERFORMANCE_REVIEW_IMPLEMENTATION.md` | 归档，写明对应提交和已被替代模块 | 因标题像重复就直接删 |
| `docs/HARMONYOS_NEXT_DEVICE_AUTOMATION_DESIGN.md` | 先读内容，决定保留 ADR 摘要或标记 superseded，并指向现行指南 | 与现行指南同时自称最终规范 |
| `docs/HARMONYOS_NEXT_DEVICE_AUTOMATION_DESIGN_2026-08-12.md` | 历史设计归档，保留做过哪些决策的证据 | 让 Codex 根据旧 restricted profile 方案重写当前统一会话 |
| `docs/HARMONYOS_NEXT_DEVICE_AUTOMATION_OPTIMIZATION_2026-08-14.md` | 逐条映射当前修复/未修复项，之后归档 | 假定其中每一项仍未实现 |
| `docs/CODEX_PIORA_*_2026-*.md`、阶段性 kickoff/release goal 等 | 全文审查后归入设计历史；保留有效现行约束的唯一入口 | 只因名字带 CODEX 就批量清空 |
| `README.zh-CN.md` | 保留历史链接入口，去掉复制版本号，简化为主文档跳转 | 误认为当前主 README 是英文而重新复制中文全文 |
| `README.ja.md`、`README.ru.md` | 阅读后决定保留简短语言入口或完整维护译文；标注覆盖程度 | 宣称完整翻译但实际只是跳转；直接删掉外部链接入口 |

迁移文档时检查所有相对链接与图片路径。现有 `docs/archive/` 已存在，不要再造多个含义重叠的 `old_docs/legacy_docs/archive_docs/`。

### 7.2 有条件删除或合并的候选

| 候选 | 当前证据与条件 | 验证要求 |
|---|---|---|
| `app/api/harmony/approval/route.ts` 的 metadata-only 实现 | 不承担真实审批；应被 H06 集成替换，或无调用后废弃 | 搜索 API URL、UI、扩展、测试和外部 API 文档；不能直接删除后留下死按钮 |
| `artifacts/piora-og.png` | 此次查看 artifacts 树只有此文件，约 1.28 MB；代码搜索未命中只是候选线索 | 检查官网、GitHub social preview、README、构建脚本和站点资产；有用途则移入归属清晰的 public/branding 位置，不凭无 import 删除 |
| 旧 runtime profile / approval 类型和兼容分支 | 如 `HarmonyPanel` 仍有 `normal/device-control` 类型；不证明全部无用 | 搜索 desktop profile 初始化、配置迁移和测试；确认兼容期限后再删 |
| 迁移后的重复 action/key/schema 片段 | H05 后可删除 | 确认 HTTP、Agent、scenario 均从统一目录生成/适配，兼容用例通过 |
| 迁移后的旧 Manager/HDC 内部实现 | H02–H18 分批提取后成为真正冗余 | 先保留 façade，再以等价运行测试证明可删；不要维护新旧两套有状态真相 |
| 临时截图、录音、构建输出或本机配置 | 只有 Git tracked 清单真实发现时才是删除对象 | 不能把计划中的 `.next/`、`dist/`、缓存误称已提交；新增忽略与 hygiene 规则 |

### 7.3 不应作为“多余”删除

- `hdc-backend.ts` / `hypium-backend.ts` / `hybrid-backend.ts`：传输和兼容、持久语义 RPC、选路各有职责。
- `branding/`、`desktop/`、`website/`、`website-xiaoyi/`：多品牌和官网是不同产品入口。可以抽共享内容，不能用一次“清理”合并其数据身份、下载地址和发布渠道。
- `services/git-oauth/`：独立服务边界，不属于鸿蒙设备控制；先审引用和部署再决定，不因无前端 import 删除。
- `lib/design-to-harmony/` 及对应 UI/API：设计稿到鸿蒙代码生成，与手机自动化不是同一功能。
- `lib/harmony/check-*`：代码检查与设备操控是不同环节；应该串联而非互相替代。
- `bin/pi-web.js`：根 package 的 bin 仍指向它；如需改名先加兼容入口和废弃公告。
- `third_party/harmony-tools/` 及 `OHScrcpyServer.hap`：当前视频后端通过文件路径读取，静态 import 搜索发现不了；须保留真实构建/许可/完整性链路。
- `LICENSE`、`NOTICE`、`THIRD_PARTY_LICENSES.md`、`THIRD_PARTY_NOTICES.md`：归属和法律角色可能不同，不按“都是许可证”合并删除。
- 现有设备行为测试、浏览器测试、发布验证脚本和 `.github/workflows/test-suite.yml`：已有复用和质量保障，需增强而非清空重造。
- 桌宠、主题、剪贴板、SSH、群聊等：不是本次设备可用性瓶颈的充分证据。若商业版本要简化，使用产品配置或功能开关，不能擅自移除用户既有功能。

### 7.4 删除前必须通过的四类检查

静态与动态引用；开发和生产构建；打包后的孤立运行；外部路径与历史数据兼容。四项中任何一项不确定，保留并标候选。不需要用删除文件数量作为重构 KPI。

## 8. README 与文档重组

### 8.1 主 README 建议结构

1. 产品定位、适用人群、稳定/测试版本和安装入口。
2. 首次启动与模型配置；本地可信执行环境说明。
3. 首次使用路径：连接设备→授权→能力自检→第一条场景→查看结果。
4. 用户能力概览，链接自动生成能力表；不要把所有内部命令塞首页。
5. 鸿蒙模式的关键边界：桌面端、目标 OS/设备矩阵、手机端服务安装、语音路线、实体键限制。
6. 数据与隐私：聊天、截图、录屏、日志、音频和可选视觉模型各自的数据流。
7. 常见故障与自检/支持包。
8. 开发命令、贡献规范、CI/发布链接；以 AGENTS 和现行发布指南为规范入口。

版本号保持单一来源或自动更新，跳转页不复制版本。Piora 与 XiaoYiHarness 数据路径按 brand 配置生成或分别明确展示，不让双品牌下载区与仅 Piora 的数据位置表互相脱节。

### 8.2 建议文档布局

```text
docs/harmony/
  quickstart.md              用户首次连接
  capabilities.md            动作目录生成的能力说明
  compatibility.md           真实验证过的机型/OS/SDK/驱动矩阵
  controls.md                点击、几何、按键保持、停止和接管
  voice-input.md             三种语音路线和各自覆盖范围
  security-and-privacy.md    授权、旁路信任边界、数据流和媒体保留
  troubleshooting.md        原因码→下一步→支持包
  architecture.md            当前代码责任边界与运行协议
  testing.md                 软件/真机/故障注入/发布门禁
  migration.md               旧工具、旧配置、旧入口兼容

docs/HARMONYOS_DEVICE_AUTOMATION.md
  保留外部链接入口，做现行文档索引；不再复制全部规范。
```

### 8.3 必须具体纠正的文字

- 不再把 power 短按、屏幕长按、实体键长按混写成一个“支持长按”。
- 不把电脑 ASR 转写当手机麦克风输入，不把 app-test PCM 当第三方 App 通用注入。
- 不宣称旧快照一律被拒绝却保留旧坐标自动点击。
- 不宣称有审批而实际只记录 pending/approved metadata。
- 不把投屏初始化安装手机 HAP 隐藏在“只读预览”里；说明安装、版本、来源、权限与卸载。
- 不把 driver idle 降级为 sleep 后仍写“已验证空闲”。
- 不把 Pi 普通会话的设备工具当成禁止 shell 的沙箱。
- 不把“已写自动测试/CI 通过”写成“所有鸿蒙手机实机验证通过”。
- 修复 SenseVoiceSmall/sherpa-onnx 与残留 Whisper 文案；修复中文 README 跳转页版本号。
- AGENTS 更新当前架构，不让 Codex 同时遵守两份互斥的设备 profile 方案。

## 9. 商业交付验收：建议门槛，不是当前实测结果

商业可用的定义应是：在公开支持的设备/系统/宿主组合下，常见任务容易完成，失败能解释、可停止、可恢复，且升级不会损坏数据或失控。不是“所有手机所有系统状态都能自动操作”。

### 9.1 软件与安全正确性门槛

| 项目 | 建议验收门槛 | 证据 |
|---|---|---|
| 无效观察写入 | stale/ambiguous/invalid-tree 测试中，后端写调用数为 0 | 行为测试 trace |
| 负向断言 | 无效/不完整观察不得通过 exists:false | fixture 矩阵 |
| 租约撤销 | 撤销栅栏后无新的普通写派发；资源清理状态可追踪 | 可控时钟/并发测试 |
| 误重试 | sent-but-ACK-lost 不触发第二次有副作用写入 | 故障注入 |
| 授权 | 未授权/过期/重放/改参/换设备的高风险动作无法派发 | policy 集成测试 |
| 坐标变换 | 指定的分辨率、裁剪、旋转变换计算正确，旧几何被拒绝 | 数学用例 + UI 测试 |
| 多设备 | A 慢命令不阻塞 B；A 撤销不取消 B | 并发 trace |
| 多实例 | 同物理设备同一时间只存在一个合作实例写所有者 | 跨进程集成测试 |
| 无 HDC | 普通会话、编码和现有非设备功能可启动 | 集成测试 |
| 打包 | worker、音频资源和手机端服务在孤立发布包中可发现 | CI package smoke |

### 9.2 真机矩阵

第一批公开支持范围由实际设备资源确定。建议至少覆盖：Windows x64 桌面；三种有代表性的设备/系统组合；其中包括一台投屏尺寸不同于原生输入尺寸的设备，具备条件时加入平板/旋转或折叠屏。没有设备就标未验证，不捏造型号、系统版本或通过结果。

每个组合保存：宿主 OS、Piora 提交和包版本、HDC 来源/version、Hypium version、手机型号、OS/API/UiTest、视频服务 version/hash、屏幕 geometry、音频输入输出路线、测试日期及失败摘要。

建议场景：首次无授权连接、授权后连接、HDC 路径冲突、HAP 服务初始化、中文和多行输入、长列表、旋转、应用切换、弹窗遮挡、语义树为空、断流、断连、任务取消、人工接管、driver 崩溃、key hold、push-to-talk、声学识别、录屏导出及双实例争用。

### 9.3 耐久与故障注入目标

- 每个目标组合先执行至少 100 次短任务，再执行至少 1,000 次基础动作，并报告按动作分类的成功率、失败类型和样本量；零观察到错误不是证明绝无错误。
- 至少 50 次断连/重连与取消注入，包含动作已发送但结果丢失。要求无自动重复破坏性操作和遗留活动租约。
- 进行一次 24 小时受控 soak，记录开始/结束资源基线和全过程峰值：内存、驱动进程、文件句柄、临时文件、fport、队列长度、录屏状态。达到阈值前报告具体问题，不用“长测稳定”笼统结论。
- 语音至少使用一个版本化中文语料集，包含数字、标点、停顿、无音频和不同长度，记录输入、识别结果、成功判据和声学配置。业务识别失败与 Piora 播放/时序错误分开归因。
- power hold、touch hold 必须覆盖取消和清理不确定情形。人工终止的时刻、宿主停止派发的时刻、设备观察结果分开记录。

### 9.4 体验和性能建议预算

以下是首轮要验证和调整的目标，不是当前实测数据，也不是对模型推理或手机系统的保证：

| 指标 | 建议起始目标 | 测量边界 |
|---|---|---|
| 本地手动输入派发 | 空队列情况下 P95 ≤ 250 ms | 已授权 API 入站到后端开始派发，不含设备完成与模型推理 |
| 取消反馈 | UI P95 ≤ 300 ms 展示停止接单状态 | 点击停止到本地确认；物理释放单独报告 |
| warm UI-tree 观察 | 目标设备 P95 ≤ 1 s | 已连接且无冷启动；冷启动单独统计 |
| 视频首帧 | 已初始化服务后 P95 ≤ 3 s | 不包含第一次安装/手机授权 |
| 控制队列 | 有配置上界、溢出明确拒绝、无无限堆积 | 按设备与请求种类统计 |
| 常见小任务 | 已声明支持矩阵下，受控场景成功率 ≥ 98% | 说明样本数、任务难度和失败定义，不含 unknown 当成功 |
| 新用户操作 | 不依赖手写 HDC/包名/键码完成第一条标准场景 | 真实用户任务观察，不凭开发者自测宣称 |

如果目标不能达到，优先优化最重路径或缩小支持声明，不能删除验证、隐藏失败、以缓存旧画面冒充新观察来提高指标。

### 9.5 发布证据包

建议发布验证产物包括 `software-tests.json`、`hardware-matrix.json`、`capabilities.json`、`latency-summary.json`、脱敏故障摘要、版本与制品 hash。它们是建议新增的产物名。没有实机结果时，发布可以是明确的实验版本，但不能把未验证的新 power/audio 能力默认标为商业支持。

代码签名、更新完整性、驱动/HAP/音频模型的来源与再分发条件应作为交付检查项。不能擅自删除第三方许可或把系统 SDK 文件无依据打包再分发。

## 10. 可以直接复制给 Codex 的启动指令

```text
请在 kexijiang/Piora 仓库执行《PIORA_HARMONY_CODEX_REFACTOR_PLAN_2026-09-27.md》。
这是一份分阶段实施计划，不是要求一次性重写整个仓库。

审计基线是 53544c6d836f21d94103c7b659cc668edc87a58c。
先读完整 AGENTS.md 及相关子目录规则；查看 git status，保护用户修改。
fetch origin 后核对当前基线。若 main 已前进，重新验证 F01–F13，不恢复已经修复的问题。

本轮优先完成 H00/H01，以及 H02/H03 的可独立修复；同步完成 H06a 对未授权高风险
操作及隐式投屏安装的临时集中拦截。能够稳定完成并验证后再按依赖图继续 H04–H22。
不要因为整体计划很长就改写成另一份泛泛建议，也不要只搭接口返回假成功。

必须保留：Pi 内核及普通编码会话、多 session 后台运行、同设备串行/多设备并行、
HDC/Hypium 混合后端、现有桌面认证、两个品牌及现有非设备功能。

每个任务先写真实行为回归再修复。高风险动作必须由中心服务校验；
不能用 UI 按钮提示替代执行层授权。不能把截图空树当成旧坐标仍有效，
不能把命令 ACK 当业务通过，不能把声音播放或文字填入当手机 ASR 通过。

先做安全、正确、可取消的小 PR，再统一契约，再做按键/音频/工作台。
对 uinput、Hypium、HAP、音频路线逐设备探测；找不到公开且已验证的能力时
实现明确的 unsupported/degraded 结果，不编造通用手机音频注入。

使用现有 lint/typecheck/tests/hygiene/licenses/perf 流程，保持测试分片和 required checks。
无实机时正常实现软件、fixture 和硬件测试脚本，但将实机结果标为 blocked，
不得填入通过或伪造证据。没有用户授权，不操作个人手机上的卸载/清数据/录音/关机。

每次提交更新 CHANGELOG 的 Unreleased，按 AGENTS 在提交/推送前同步远端。
未收到明确发布指令，不创建发布标签、不发布安装包、不改变主干保护或云配置。
不得在运行 dev 的目录执行 next build；发布构建依照仓库规范交给 GitHub Actions。

每一批交付：任务ID、改动文件、已解决问题、测试命令与实际结果、未验证项、
后续依赖、兼容迁移和回退方式。不要把“已触发CI”当“全部检查通过”。
```

### 10.1 初始验证命令

以下都是基线 package 已有命令或标准 Git/Node 命令。实际执行遵守工作树状态和 AGENTS；测试按改动范围先小后大，不能以第一组通过代替全部三组。

```sh
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
node --version
npm ci
npm run build:desktop
node --test lib/harmony-device-manager.test.mjs lib/harmony-scenario-executor.test.mjs lib/harmony-hybrid-backend.test.mjs
npm run lint
npm run typecheck
npm test
npm run verify:hygiene
npm run licenses:check
npm run perf:check
```

`npm test` 的 pretest 已包含桌面构建；上面显式 build:desktop 是为了单独跑测试文件时满足原有测试依赖。完整测试需要的浏览器、平台依赖参考现有 workflow，不要通过关闭测试绕过。不得把未来的 `doctor/docs:check/hardware:check` 等拟新增脚本写成已经存在。

## 11. 来源索引

### 11.1 仓库证据（全部固定到本次审计提交）

本表是文件级复核入口。定位具体问题时同时使用上文的符号名称；不要依赖重构后会改变的行号。

- [S01] [lib/harmony/device-manager.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/device-manager.ts)
- [S02] [components/workspace/HarmonyPanel.tsx](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/components/workspace/HarmonyPanel.tsx)
- [S03] [hooks/useHarmonyLiveFrame.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/hooks/useHarmonyLiveFrame.ts)
- [S04] [app/api/harmony/action/route.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/app/api/harmony/action/route.ts)
- [S05] [lib/harmony/hdc-backend.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/hdc-backend.ts)
- [S06] [extensions/piora-harmony.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/extensions/piora-harmony.ts)
- [S07] [lib/harmony/scenario-executor.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/scenario-executor.ts)
- [S08] [app/api/harmony/approval/route.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/app/api/harmony/approval/route.ts)
- [S09] [app/api/harmony/_shared.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/app/api/harmony/_shared.ts)
- [S10] [lib/harmony/types.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/types.ts)
- [S11] [lib/harmony/hybrid-backend.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/hybrid-backend.ts)
- [S12] [lib/harmony/hypium-backend.ts](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/lib/harmony/hypium-backend.ts)
- [S13] [README.md](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/README.md)
- [S14] [README.zh-CN.md](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/README.zh-CN.md)
- [S15] [package.json](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/package.json)
- [S16] [docs/HARMONYOS_DEVICE_AUTOMATION.md](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/docs/HARMONYOS_DEVICE_AUTOMATION.md)
- [S17] [AGENTS.md](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/AGENTS.md)
- [S18] [.github/workflows/ci.yml](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/.github/workflows/ci.yml)
- [S19] [.github/workflows/test-suite.yml](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/.github/workflows/test-suite.yml)
- [S20] [website-xiaoyi/README.md](https://github.com/kexijiang/Piora/blob/53544c6d836f21d94103c7b659cc668edc87a58c/website-xiaoyi/README.md)

### 11.2 官方平台资料（查询于 2026-09-27）

- [O01] [OpenHarmony：UI 测试框架使用指导](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/application-test/uitest-guidelines.md)。说明 keyEvent 的 Power 与键码支持；不据此推断实体键 hold。
- [O02] [OpenHarmony：uinput](https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/dfx/uinput.md)。键盘 down/up/interval/long_press 及其参数限制。主分支文档不是每款量产 HarmonyOS 设备的兼容保证，实施必须保存目标版本的 help 和验证记录。
- [O03] [华为：音频录制概述](https://developer.huawei.com/consumer/cn/doc/doccenter-feature-dev/bpta-audio-record-overview)。AudioCapturer/OHAudio 属于音频采集与录制能力；该资料不构成任意 App 麦克风注入接口的证明。

## 12. 最终交付判定

完成的判据不是删除了多少文件、注册了多少工具，也不是 README 写上了“商用”。

应当是：用户能明确知道当前手机能做什么；Agent 能用少量清楚的动作完成真实任务；
输入和语音有端到端结果；操作失败不误点、不盲目重试；任何任务都能停止和交接；
崩溃、断连、升级后状态可信；承诺的支持范围有可复核的真机证据。

本计划不授权实际删除用户数据、操作个人设备或发布版本。执行这些动作时仍必须遵循
用户明确指令、已配置授权和仓库发布规范。
