# Piora 桌宠 2.0：独立工作伙伴与自治心智设计

> 状态：已实现
> 目标平台：Windows 优先，Linux X11/XWayland 兼容
> 适用版本：Piora v0.4.26
> 核心原则：模型决定“想做什么”，宿主程序决定“能不能做、怎么安全地做”。

## 1. 目标

桌宠不再是 Piora 主窗口里的一个功能卡片，也不只是随机播放动画、点击后生成一句话。它应当是独立存在的工作伙伴：

1. 宠物本体常驻桌面，透明、无矩形底纹、不抢焦点、不妨碍点击其他应用。
2. 单击与宠物互动；双击打开宠物自己的“小页面”；右键打开原生快捷菜单。
3. 宠物能观察 Piora 内部的任务、进度、工作节奏与 Token 概况，并保持可检查的短期状态和长期记忆。
4. 模型能在受限动作集合内决定说话、表情、动画、走动、安静等待或提出任务建议。
5. 程序不预制互动台词；无模型或模型失败时仅做安静的本地动画，不冒充“有思想”。
6. 所有自治行为可暂停、限频、审计和撤销；模型永远不能直接执行 Shell、修改文件或操纵其他应用。
7. 任务管理和资料库属于宠物的独立面板，Piora 设置页只保留入口与基础配置。

## 2. 不做什么

- 不展示或保存模型的原始思维链。界面只展示模型生成的简短“想法摘要”和程序可验证的触发原因。
- 不监听全局键盘，不读取其他应用窗口标题，不截屏，不记录用户在 Piora 之外的活动。
- 不让模型逐帧控制坐标。模型提交语义动作，统一运动引擎负责路径、碰撞、屏幕边界和帧率。
- 不允许自治模型直接创建、删除或完成任务。模型可以提出变更草案，用户确认后才写入。
- 不用饥饿值、付费养成值或固定日常任务伪装“生命感”。生命感来自连续记忆、情绪状态和情境化选择。

## 3. 当前实现诊断

### 3.1 悬浮底纹的实际根因

`app/globals.css` 给所有按钮注入了全局交互基线：

```css
button:not(:disabled):hover { background-image: linear-gradient(...); }
button:not(:disabled):active { background-image: linear-gradient(...); transform: scale(.98); }
```

桌宠本体是 `<button>`。此前模块样式只写了 `background: transparent`，但全局选择器的优先级更高，所以鼠标经过时仍会出现矩形渐变，按下时还会缩小。修复必须显式清除 `background-image` 和 `transform`，并使用足以压过全局基线的优先级。

长期方案还必须解决透明窗口的矩形命中区：透明像素默认也会挡住桌面点击。宠物窗口应默认 click-through，仅在指针命中精灵有效区域时恢复交互。

### 3.2 架构差距

当前 `DesktopCompanionWindow.tsx` 同时承担：

- 窗口内容渲染；
- 任务气泡；
- 模型请求；
- 随机漫游定时器；
- 拖拽；
- Agent 事件反应；
- 个人任务展示。

这使“行为”“窗口”“模型”“数据”互相耦合。现有漫游是 `10–24 秒随机定时 + 随机距离`，不是模型决策；状态也主要依赖主窗口通过 `BroadcastChannel` 推送，主窗口未加载时上下文不完整。

## 4. 产品形态：三个独立表面

### 4.1 Pet Window：宠物本体

- 透明、无边框、跳过任务栏、可选置顶。
- 默认尺寸只覆盖宠物精灵，不再为了任务列表扩大到 236×360。
- 不渲染任务工作台，不放设置按钮。
- 只显示宠物、短时气泡锚点、情绪/注意力小标记。
- 普通状态不获取键盘焦点；用户直接点击时才短暂进入交互态。

### 4.2 Bubble Window：气泡层

- 独立透明窗口，锚定在宠物上方或左右侧。
- 默认 click-through，不阻挡宠物或后方应用。
- 文本 1–2 行，最多 90 个中文字符，4–10 秒后自动消失。
- 只有包含明确按钮的确认气泡才可交互；普通语言气泡永远不抢焦点。
- 宠物移动时跟随，超出屏幕时自动翻转方向。

把气泡拆成独立窗口可以避免“为了显示一句话而扩大宠物窗口”，也避免大块透明区域吞掉鼠标事件。

### 4.3 Companion Panel：宠物随身舱

这是用户要求的“小页面”，由独立 `BrowserWindow` 承载，不嵌在 Piora 主窗口里。

- 建议尺寸：420×620，最小 380×520，可调整大小。
- 双击宠物打开；再次双击关闭。
- 打开位置靠近宠物，并被限制在当前显示器工作区内。
- 主窗口关闭或隐藏时仍能独立工作。
- 失焦后可按设置自动隐藏；编辑任务或资料时不自动隐藏。
- 路由：`/desktop-companion-panel`。

面板导航：

1. **此刻**：宠物当前心情、想法摘要、正在关注的任务、最近一次决定、快捷对话框。
2. **任务**：Agent 任务只读进度 + 个人任务增删改、项目、截止时间、进度和状态。
3. **收藏**：笔记、代码、命令、图片；默认只复制，命令不直接执行。
4. **记忆**：模型记住了什么、来源、创建时间；每条可编辑、禁用或删除。
5. **心智设置**：模型、人格、主动程度、安静时段、允许动作、上下文预览和清空记录。

Piora 主设置页只保留：显示/隐藏桌宠、打开随身舱、开机启动、置顶、宠物外观、模型和总开关。任务与收藏的完整管理界面从主窗口移除。

## 5. 输入手势与冲突规则

| 输入 | 结果 | 说明 |
| --- | --- | --- |
| 单击 | 触发 `user.poke` | 延迟约 260ms，确认不是双击后再请求模型 |
| 双击 | 打开/关闭随身舱 | 不同时触发单击对话 |
| 左键拖动 | 移动宠物 | 超过 5px 后取消单击；拖动期间暂停自治运动 |
| 右键 | 原生快捷菜单 | 不调用模型 |
| Shift + 双击 | 直接打开“任务”页 | 高效入口，可后续实现 |
| 托盘左键 | 打开随身舱 | 符合状态型托盘图标的预期 |
| 托盘右键 | 原生托盘菜单 | 与宠物右键菜单保持核心命令一致 |

右键菜单第一版：

- 打开宠物随身舱
- 跟它聊聊
- 查看正在运行的任务
- 暂停主动行为 / 恢复主动行为
- 安静 1 小时
- 始终置顶
- 回到屏幕右下角
- 桌宠设置
- 隐藏桌宠

所有菜单文字由 i18n 提供，不在 Electron 主进程散落硬编码中文。

## 6. “有思想”的正确实现

模型不是持续运行的大脑。成熟实现应当是一个**事件驱动、可休眠、可审计的心智循环**：

```text
Piora 事件 / 用户互动 / 定时唤醒
                ↓
        Perception Builder
        生成有界事实快照
                ↓
        Companion Mind
   工作记忆 + 心情 + 人格 + 最近决定
                ↓
      Decision Model（结构化输出）
                ↓
       Policy / Action Arbiter
  权限、频率、安静模式、屏幕边界校验
                ↓
 Speech / Animation / Motion / Proposal
                ↓
      Outcome + 可见决定记录
```

用户感受到的“思考”由四件事组成：

1. **连续性**：宠物记得最近发生的任务完成、失败、休息和用户互动。
2. **选择性**：同样是空闲，它可以选择安静、观察、走动或说话，而不是固定轮播。
3. **可解释性**：随身舱显示“看到的事实 → 当前意图 → 做出的动作”。
4. **克制性**：宠物知道什么时候不该打扰，这比频繁弹话更像有判断力。

### 6.1 不显示原始思维链

模型输出 `thoughtSummary`，例如“他已经专注很久了，我想提醒他喘口气”。这是面向用户的简短自我陈述，不是模型的隐藏推理过程。

程序同时生成事实来源，例如：

> 触发原因：连续工作 96 分钟；当前没有等待确认的任务；过去 30 分钟未提醒过休息。

事实来源必须由程序从事件匹配得到，不能由模型自由编造。

## 7. 心智状态

```ts
interface CompanionMindStateV1 {
  version: 1;
  personality: {
    name: string;
    traits: string[];       // 最多 8 个，例如“温和、简洁、有一点俏皮”
    speakingStyle: string;  // 最多 300 字
    boundaries: string;     // 用户不希望它做什么
  };
  mood: {
    label: string;          // 对用户可见，例如“安静陪伴”
    valence: number;        // -1..1
    energy: number;         // 0..1
    updatedAt: number;
  };
  focus: {
    kind: "none" | "agent-task" | "personal-task" | "rest" | "user";
    id?: string;
    title?: string;
    since: number;
  };
  lastDecision?: CompanionDecisionRecord;
  recentIntentKeys: string[];
  nextWakeAt: number | null;
  quietUntil: number | null;
  autonomyPaused: boolean;
}
```

心情不是随机数字。任务成功提高愉悦度，失败降低但不夸张，长时间无互动让能量缓慢下降，用户点击和休息后恢复。所有数值会随时间回归中性，避免状态永久偏离。

## 8. 感知上下文

模型每次只收到白名单快照：

```ts
interface CompanionPerceptionV1 {
  event: {
    id: string;
    type: CompanionEventType;
    occurredAt: number;
    subjectId?: string;
  };
  time: {
    localHour: number;
    weekday: number;
    quietHours: boolean;
  };
  workRhythm: {
    continuousWorkMinutes: number;
    minutesSinceLastRest: number | null;
    completedToday: number;
    failedToday: number;
  };
  currentSession?: {
    title?: string;
    status?: string;
    tokens?: number;
    contextPercent?: number | null;
  };
  runningTasks: Array<{
    id: string;
    title: string;
    phase: string;
    progressPercent?: number;
    waitingForUser: boolean;
    activeMinutes?: number;
  }>;
  personalTasks: Array<{
    id: string;
    title: string;
    progress: number;
    dueState?: "none" | "future" | "today" | "overdue";
  }>;
  mind: {
    mood: CompanionMindStateV1["mood"];
    focus: CompanionMindStateV1["focus"];
    lastVisibleAction?: string;
    recentIntentKeys: string[];
  };
  actionAvailability: CompanionActionAvailability;
}
```

默认不发送：聊天正文、模型原始思考、工具输出、文件路径、代码、命令内容、图片、资料库正文、其他应用信息。

随身舱必须提供“本次将发送给模型的上下文”预览，并允许逐类关闭。

## 9. 事件模型

```ts
type CompanionEventType =
  | "app.started"
  | "user.poke"
  | "user.ask"
  | "user.dragged"
  | "user.opened_panel"
  | "task.started"
  | "task.progressed"
  | "task.waiting_user"
  | "task.completed"
  | "task.failed"
  | "work.long_session"
  | "work.returned_after_rest"
  | "personal_task.due"
  | "scheduler.heartbeat";
```

事件进入持久化的有界队列。相同任务的高频进度事件按 10 秒窗口合并，只保留最新进度，避免模型调用风暴。

事件优先级：

1. 用户直接互动；
2. 等待用户确认、任务失败；
3. 任务完成、到期提醒；
4. 工作节奏提醒；
5. 普通心跳和空闲行为。

## 10. 模型决策协议

统一接口：`POST /api/companion/decide`。

模型必须返回严格 JSON，不返回 Markdown，不返回工具调用：

```ts
interface CompanionDecisionV1 {
  version: 1;
  intent:
    | "acknowledge"
    | "encourage"
    | "comfort"
    | "celebrate"
    | "remind_rest"
    | "observe"
    | "play"
    | "assist"
    | "stay_quiet";
  intentKey: string;          // 用于去重，如 rest-after-90m
  thoughtSummary: string;     // 8..60 个中文字符，不含隐式推理
  mood: {
    label: string;
    valence: number;
    energy: number;
  };
  speech?: {
    text: string;             // 最多 90 个中文字符
    ttlMs: number;            // 4000..10000
  };
  actions: CompanionActionV1[]; // 最多 3 个
  focus?: {
    kind: "none" | "agent-task" | "personal-task" | "rest" | "user";
    id?: string;
  };
  memoryProposal?: {
    text: string;             // 最多 200 字，必须等待用户确认
    reason: string;
  };
  taskProposal?: {
    operation: "create" | "update";
    taskId?: string;
    title?: string;
    progress?: number;
    reason: string;
  };
  nextThinkAfterSeconds: number; // 60..3600
}
```

模型的系统约束：

- 只能依据输入事实，禁止虚构工作量、任务结果或用户情绪。
- `stay_quiet` 是正常且受鼓励的决定。
- 不复述统计表；语言要像角色自然表达。
- 一次只表达一个主要意图。
- 不承诺程序没有的能力。
- 不输出内部思维链，只输出用户可见摘要。
- 任务和记忆只能形成提案。

模型调用建议：超时 12 秒，输出上限 400 tokens，不缓存，最多重试一次；结构校验失败时不展示残缺文本。

## 11. 动作能力 DSL

```ts
type CompanionActionV1 =
  | { type: "animate"; state: "idle" | "look" | "wave" | "jump" | "dance" | "sit" | "sad"; loops?: number }
  | { type: "face"; target: "cursor" | "taskbar" | "screen-center" }
  | { type: "move"; pattern: "wander" | "approach-cursor" | "retreat-cursor" | "screen-edge" | "home"; distancePx?: number; durationMs?: number }
  | { type: "emote"; symbol: "question" | "idea" | "heart" | "rest" | "success" | "warning" }
  | { type: "open_panel"; page: "now" | "tasks" | "library" | "memory"; userInitiatedOnly: true };
```

第一版不开放自由坐标、自由 URL、声音播放、文件读取、Shell、剪贴板写入或主窗口控制。

模型只选动画语义。若当前宠物包没有 `dance`，渲染映射按照宠物自己的 fallback 链降级到 `wave`、`jump` 或 `idle`。

## 12. Action Arbiter：安全裁决器

所有模型输出先经过裁决器，绝不能直接执行：

```ts
interface CompanionActionPolicy {
  speechPer30Minutes: number;       // 默认 3
  autonomousMovesPer10Minutes: number; // 默认 4
  maxMoveDistancePx: number;        // 默认 280
  allowApproachCursor: boolean;     // 默认 false
  allowCrossDisplay: boolean;       // 默认 false
  suppressInFullscreen: boolean;    // 默认 true
  suppressDuringQuietHours: boolean;// 默认 true
  pauseWhileUserDragging: boolean;  // 固定 true
  pauseWhilePanelEditing: boolean;  // 固定 true
}
```

裁决顺序：

1. 验证 JSON 版本、字符串长度、枚举和数字范围；
2. 检查全局暂停、安静时段、全屏/演示状态；
3. 检查动作权限与频率预算；
4. 去重最近的 `intentKey`；
5. 取消互斥动作，例如拖拽时移动、用户编辑时自动隐藏面板；
6. 将语义移动转换为屏幕内安全路径；
7. 执行并记录实际结果，包括被拒绝的原因。

模型无权绕过裁决器。被拒绝的动作不会用另一种动作偷偷替代。

## 13. 自治调度策略

### 13.1 什么时候调用模型

- 用户单击或提问：立即调用。
- 任务开始、完成、失败、等待确认：事件触发，但受 5 秒合并窗口控制。
- 连续工作达到 60/90/120 分钟：每个阈值一天最多一次。
- 心跳：只有当前时间达到 `nextWakeAt` 且存在有意义变化时调用。

### 13.2 什么时候不调用

- 用户处于安静时段或手动暂停；
- 过去 30 秒上下文没有任何变化；
- 宠物不可见；
- 模型未配置、离线或连续失败后进入熔断期；
- 系统检测到全屏/演示，且用户未允许打扰。

### 13.3 空闲行为

空闲不意味着固定随机走动。模型在一次决策中可以给出“接下来的一小段意图”，例如：

```json
{
  "intent": "play",
  "thoughtSummary": "现在没有紧急任务，我想在旁边活动一下",
  "actions": [
    { "type": "move", "pattern": "wander", "distancePx": 140, "durationMs": 2600 },
    { "type": "animate", "state": "sit", "loops": 2 }
  ],
  "nextThinkAfterSeconds": 900
}
```

运动引擎执行一次后休眠，不反复请求模型。无模型时只允许低频 `idle` 动画，不说话、不主动漫游。

## 14. 运动与透明命中

### 14.1 单一运动写入者

新增一个主进程运动引擎，所有移动都经过它：

- 约 60fps 的共享 ticker；
- 子像素累计，避免慢速移动抖动；
- 宠物、气泡锚点和面板位置只读该引擎状态；
- 拖拽、模型移动、回家、显示器变化不能同时写窗口坐标；
- 显示器拔插后重新夹取到最近工作区。

### 14.2 透明像素不挡鼠标

Windows/macOS：

1. 宠物窗口平时调用 `setIgnoreMouseEvents(true, { forward: true })`；
2. Renderer 根据精灵 alpha mask 或有界 hit polygon 报告指针是否命中宠物；
3. 命中时主进程切换为 `setIgnoreMouseEvents(false)`；
4. 主进程使用 `screen.getCursorScreenPoint()` 作为 watchdog，防止转发丢失后宠物永远不可点击。

Linux：优先 X11/XWayland。Native Wayland 无法可靠控制顶层窗口位置，应明确降级为“固定位置 + 手动交互”，而不是假装移动成功。

### 14.3 运动礼仪

- 不突然跳到另一个屏幕；
- 默认不靠近鼠标，除非用户开启；
- 与光标至少保持 48px 安全距离；
- 不在 2 秒内连续改变方向；
- 用户开始拖动后立即取消模型运动；
- 不获取焦点，不置顶到系统安全界面之上。

## 15. 记忆系统

分三层，全部可查看和删除：

### 15.1 Working Memory

当前任务、最近 10 个事件、最近 6 次决定、当前心情和焦点。用于每次决策，重启后可恢复最后状态但自动衰减。

### 15.2 Episodic Memory

记录重要事件摘要，例如“今天完成了 Piora v0.4.25 打包”“用户在失败后继续重试”。最多保存 500 条，按时间和重要度淘汰。不能保存聊天原文或代码。

### 15.3 User-approved Memory

模型提出“我是否可以记住：你希望工作 90 分钟后提醒休息？”，用户确认后保存。每条包含来源、创建时间和作用域。模型不能静默写入长期偏好。

记忆存储必须从 `localStorage` 迁移到服务端版本化 JSON，使用临时文件 + 原子替换：

```text
~/.pi/agent/piora/companion/
  state.json
  mind.json
  memories.jsonl
  decisions.jsonl
  library/
```

图片资料使用文件存储，元数据记录哈希与相对路径，不再把 Data URL 大量塞入 `localStorage`。

## 16. 任务与资料库

### 16.1 任务

- Agent 任务：来自 `TaskRuntimeSnapshot`，只读展示运行阶段、步骤进度、等待用户、失败和产物。
- 个人任务：支持标题、说明、项目、截止时间、进度、状态、标签和排序。
- 模型可以提出“把这个任务进度调到 80%”或“创建一个复查任务”，随身舱展示 diff，用户确认后应用。
- 双击任务跳转到对应 Piora 会话；若主窗口未打开，则先创建/显示主窗口再导航。

### 16.2 资料库

- 类型：笔记、代码、命令、图片、文件引用。
- 宠物模型默认只能看到标题、类型和用户选中的条目，不能看到全部正文。
- 命令条目只有“复制”按钮；第一版不提供“运行”。
- 图片使用缩略图，原图不发送给互动模型，除非用户在一次明确对话中选中并授权视觉模型。

## 17. 窗口与服务架构

```text
Electron Main
  CompanionController
    ├─ PetWindowController
    ├─ BubbleWindowController
    ├─ PanelWindowController
    ├─ CompanionMotionEngine
    ├─ CompanionScheduler
    └─ CompanionActionArbiter
             │ loopback private API
             ▼
Next.js Server
  CompanionRuntime
    ├─ PerceptionBuilder
    ├─ DecisionModelAdapter
    ├─ MindStore
    ├─ Task/Library Store
    └─ Event/Decision SSE
             │
             ▼
Sandboxed renderers
  /desktop-pet
  /desktop-companion-bubble
  /desktop-companion-panel
```

Electron 主进程拥有窗口和运动权限；Next.js 服务拥有 Pi 模型、任务数据和持久化；Renderer 只渲染并通过最小 preload bridge 发出用户意图。

## 18. API 与 IPC

服务端 API：

- `GET /api/companion/state`：随身舱初始快照。
- `GET /api/companion/events`：SSE，发送 mind/task/library/decision 更新。
- `POST /api/companion/decide`：创建一次模型决策；要求事件幂等键。
- `GET/PUT /api/companion/mind`：人格、权限、安静时段。
- `GET/POST/PATCH/DELETE /api/companion/tasks`：个人任务。
- `GET/POST/PATCH/DELETE /api/companion/library`：资料库。
- `POST /api/companion/proposals/:id/apply`：用户确认模型提案。
- `DELETE /api/companion/history`：清空决定和事件记录。

所有 mutation：同源、桌面 token、严格 body 上限、明确字段验证、原子写入。

Preload bridge：

```ts
interface PiCompanionDesktopBridge {
  petPointerState(input: { overOpaquePixel: boolean }): Promise<void>;
  petGesture(input: { type: "click" | "double-click" | "drag-start" | "drag-move" | "drag-end" }): Promise<void>;
  openCompanionPanel(page?: "now" | "tasks" | "library" | "memory"): Promise<boolean>;
  setCompanionPanelEditing(editing: boolean): Promise<void>;
  showCompanionContextMenu(): Promise<void>;
  onCompanionRenderState(listener: (state: CompanionRenderState) => void): () => void;
}
```

Renderer 不允许自行设置任意窗口坐标或打开任意 URL。

## 19. 建议文件边界

```text
desktop/src/companion/
  companion-controller.ts
  companion-window-manager.ts
  companion-motion-engine.ts
  companion-hit-test.ts
  companion-action-arbiter.ts
  companion-scheduler.ts
  companion-menu.ts

app/
  desktop-pet/page.tsx
  desktop-companion-bubble/page.tsx
  desktop-companion-panel/page.tsx
  api/companion/{state,events,decide,mind,tasks,library,proposals}/...

components/companion/
  PetSurface.tsx
  BubbleSurface.tsx
  CompanionPanel.tsx
  CompanionNow.tsx
  CompanionTasks.tsx
  CompanionLibrary.tsx
  CompanionMemory.tsx
  CompanionMindSettings.tsx

lib/companion-v2/
  types.ts
  validators.ts
  event-store.ts
  mind-store.ts
  perception-builder.ts
  decision-prompt.ts
  decision-parser.ts
  task-store.ts
  library-store.ts
  migrations.ts
```

不要继续把所有逻辑添加到 `DesktopCompanionWindow.tsx` 或 `desktop/src/main.ts`。

## 20. 开发顺序

### 阶段 A：窗口解耦与命中修复

1. 固化全局 hover/active 回归测试。
2. 将任务气泡移出宠物本体窗口。
3. 新建独立随身舱窗口和路由。
4. 实现单击/双击/拖动互斥。
5. 实现透明像素 click-through 与 watchdog。

验收：桌面上看不到矩形底纹；透明区域可点击后方窗口；双击打开随身舱且不说话；主窗口隐藏时随身舱仍可打开。

### 阶段 B：统一运行时与持久化

1. 建立 `CompanionRuntime`、事件队列和 SSE。
2. 将任务、资料、偏好从 localStorage 迁移到版本化服务端存储。
3. 主窗口不再作为桌宠上下文的唯一生产者。

验收：重启 EXE 后任务、记忆、心情与窗口位置恢复；主窗口从未打开时桌宠仍能读取运行任务。

### 阶段 C：模型心智循环

1. 实现 perception 白名单。
2. 实现严格决策协议和解析器。
3. 实现动作裁决器、预算、去重、安静模式与熔断。
4. 将点击、任务事件和心跳接入同一决策入口。

验收：连续点击得到基于实时事实的不同表达；模型可选择不说话；无效 JSON 不产生半截气泡；模型无法越权修改任务或移动到屏幕外。

### 阶段 D：运动与生命感

1. 建立单一共享运动引擎。
2. 实现语义动作到安全路径的映射。
3. 加入心情衰减、焦点和最近意图。
4. 随身舱“此刻”页显示可见想法与决定时间线。

验收：宠物会在合适的空闲时机选择移动/观察/安静；动作不抖动、不抢焦点、不挡鼠标；用户能解释它为什么刚才那样做。

### 阶段 E：任务、资料与长期记忆

1. 完成任务中心与资料库的独立面板。
2. 实现模型任务/记忆提案与用户确认。
3. 实现记忆查看、编辑、删除、导出和全部清空。

验收：任何长期记忆与任务变化都有用户确认和审计记录；资料正文不会在后台自动发给模型。

## 21. 测试与验收矩阵

### 21.1 视觉与输入

- Playwright/Electron 测试读取 hover、active 前后的 computed style：`backgroundImage === "none"`、`transform === "none"`。
- Windows 实机截图差分：透明像素 alpha 保持 0。
- 点击宠物旁边的透明区域，后方测试窗口收到点击。
- 单击只产生一次 `user.poke`；双击只打开面板；拖动不产生 poke。
- 100%、125%、150%、200% DPI 下命中区与精灵一致。

### 21.2 模型协议

- 每个枚举、长度、数值边界和未知字段都有单测。
- 恶意输出包含 URL、Shell、任意坐标、超长文本时被拒绝。
- 超时、断网、模型下线、空响应、非 JSON、重复事件均不会重复发言。
- 相同 `intentKey` 在冷却期内被抑制。

### 21.3 自治行为

- 安静时段、全局暂停、全屏、拖拽、面板编辑时不主动打扰。
- 任务完成/失败/等待确认的事件优先级正确。
- 每 30 分钟主动语言不超过预算。
- 宠物下线时调度器停止，恢复时不会补发过期事件。

### 21.4 数据与隐私

- 老版本 todos/library/preferences 无损迁移。
- 原子写中断后旧数据仍可读取。
- API 不返回本地绝对路径、API key、聊天正文或工具输出。
- 删除记忆后模型上下文中不再出现。

### 21.5 窗口与多显示器

- 插拔显示器、改变缩放、任务栏换边后所有窗口仍在可见区。
- 宠物移动时气泡锚点稳定，无相互竞争的坐标写入。
- Windows 便携版、安装版与 Linux AppImage 均做启动和窗口冒烟测试。

## 22. 完成定义

只有同时满足以下条件才算桌宠 2.0 完成：

- 宠物本体、气泡、随身舱是职责分离的独立桌面表面；
- 悬浮/按下无底纹，透明区域不挡桌面点击；
- 双击/右键可以在不打开 Piora 主界面的情况下使用宠物随身舱；
- 点击、任务事件和空闲心跳都进入同一个模型决策协议；
- 模型能选择说话、动作、移动或保持安静，并受动作裁决器限制；
- 当前想法、触发事实、心情和最近决定在随身舱可见；
- 任务、资料、记忆跨重启持久化，模型写操作必须用户确认；
- 隐私预览、安静模式、暂停开关、行为预算和清空记录全部可用；
- 单测、Electron 交互测试、多 DPI/多显示器验证和 Windows/Linux 打包门禁全部通过。

## 23. 设计依据

- Shimeji-ee 将 actions 与 behaviors 分开，证明“能做什么”和“何时做”应是两个层次。
- OpenPets 将透明宠物窗口、控制中心、反应映射、运动引擎和权限宿主分开，并由主进程掌握窗口权力。
- Electron 提供透明无边框窗口、原生菜单、托盘菜单与 `setIgnoreMouseEvents`；这些能力应在主进程封装，Renderer 只拿到窄 IPC。
- Windows 通知区域规范强调用户控制、安静时段和不打扰，因此宠物的主动行为必须可关闭、可限频并尊重系统状态。
