# Design to Harmony — 完整设计稿转鸿蒙代码功能规格

状态：设计冻结；阶段 0/1/2 已实现并验收（2026-09-01）

目标版本：先完成结构化设计稿 MVP，再逐步开放工程级同步

首发设计源：Figma 完整文件或文件内选定页面/流程

代码目标：HarmonyOS ArkUI / ArkTS 工程

### 当前实施状态

已完成的阶段 0/1/2 边界：

- 右侧工作区主入口“设计转鸿蒙”，以及命令面板的辅助入口。
- Figma 完整文件链接与本机访问令牌连接，不提供截图或文件上传入口。
- 页面、顶层节点、流程、组件、组件集、样式和变量的只读摘要。
- 可替换的 `DesignSourceAdapter`、Figma adapter、版本化导入记录和项目级缓存。
- 24 KiB 请求体上限、允许工作区校验、严格 URL 校验、30 秒上游超时、16 MiB 响应上限、项目隔离读取和无敏感信息状态响应。
- 变量接口权限不足时的可见降级，不阻断其余设计文件导入。
- 窄右栏与最大化工作台共用的响应式文档树界面；支持多范围选择和只读分析，生成与应用动作仍保持禁用。
- 版本固定的深度节点读取、递归依赖闭包、确定性 `NormalizedDesignIR` 和 `HarmonyUiPlan`。
- Harmony 模块与现有 `.ets` 组件扫描，以及组件、变量、图片和原型跳转映射。
- 阻断、需确认和提醒三级问题检查器；不支持能力不会被静默丢弃。
- 项目隔离的分析运行持久化、单调 revision、确定性 run/plan id、缓存与相同并发请求合并。
- 多页设计 fixture、适配器/凭据/缓存/API 边界测试、IR/计划/映射/并发测试、入口与界面结构测试，以及浏览器级响应式验收。

尚未进入实现的阶段：ArkUI 暂存生成、差异审阅、显式应用、ArkTS 编译与真机视觉验证。后续阶段必须继续保持“先暂存、再审阅、最后明确应用”的写入边界。

## 1. 决策摘要

Piora 应把这个功能定位为“结构化设计稿到鸿蒙工程”，而不是“截图转代码”。

系统读取完整设计文件中的页面、画板、组件、实例、变体、Auto Layout、约束、设计变量、素材和原型交互，先生成一份可检查的中间结构，再生成 ArkUI / ArkTS。设计稿导出的图片只用于真机视觉对比，不作为主要生成输入。

产品入口放在现有右侧工作区的工具列表中，名称为“设计转鸿蒙”。它和“文件”“审阅”“终端”“浏览器”“鸿蒙设备”处于同一层级，可在分栏模式下与对话并排，也可使用现有的最大化能力进入专注工作台。

不在左侧任务栏增加新的一级栏目，不新增 ChatInput 的特殊模式，也不改变 AgentSession 的核心提示协议。

完整设计稿可以整份导入和同步，但代码生成必须按“页面、流程或组件集合”分批执行。系统自动补齐所选范围依赖的组件、变量和素材，避免一次生成大型文件的全部页面。

## 2. 产品目标

用户应当能够：

1. 连接一个完整的结构化设计文件。
2. 浏览文件中的页面、流程、画板、组件库、变量和原型关系。
3. 选择要生成的页面、流程或组件集合。
4. 检查设计组件到 ArkUI 或项目现有组件的映射。
5. 处理设计稿中缺失或鸿蒙无法直接表达的信息。
6. 在不修改用户项目的前提下生成预览产物。
7. 查看将要新增和修改的文件。
8. 编译预览产物，并可选地运行到模拟器或真机。
9. 将设计稿参考画面与真实运行截图叠加、并排或差异显示。
10. 明确批准后才把变更应用到当前项目。
11. 设计稿更新后只重新生成受影响的页面和组件。
12. 检测用户对生成文件的手工修改，绝不静默覆盖。

## 3. 非目标

首个版本不承诺：

- 从设计稿推断真实接口、数据库和业务规则。
- 自动生成完整商业应用的所有逻辑。
- 自动理解设计稿中没有表达的权限、错误恢复和异常状态。
- 支持所有设计工具的私有文件格式。
- 支持所有 Figma 效果、混合模式、插件数据和复杂动画。
- 一次点击后直接写入用户项目。
- 用一个“相似度分数”替代真实的视觉差异检查。
- 自动覆盖已经被用户修改的生成代码。

## 4. “完整设计稿”的定义

首发版本读取的不是单张图片，而是设计文档的结构化信息。

### 4.1 必须读取

- 文件、页面、Section、Frame 和画板层级。
- Group、Text、Shape、Vector、Image、Component、Instance。
- Auto Layout 的方向、间距、内边距、对齐和尺寸策略。
- 绝对定位、约束、裁切、圆角、描边、阴影、透明度。
- 文字内容、字体家族、字重、字号、行高、字距和对齐。
- Component Set、Variant 属性和实例覆盖值。
- 颜色、字号、间距等设计变量及其模式。
- 素材引用和可导出矢量、位图资源。
- Prototype 中的点击跳转、返回、弹层和基础状态切换。
- 设计文件版本或更新时间，支持后续增量同步。

### 4.2 首版支持矩阵

| 设计能力 | 首版处理方式 |
| --- | --- |
| 横向/纵向 Auto Layout | 映射为 Row、Column、Flex 布局 |
| 叠放和局部绝对定位 | 映射为 Stack 及位置约束 |
| 重复卡片和列表 | 映射为可复用组件与 List；数据作为属性或示例数据 |
| Component / Instance | 优先映射项目组件，否则生成 ArkUI 组件 |
| Variant | 映射为枚举属性和组件状态 |
| 设计变量 | 映射为 Harmony 资源或项目设计令牌 |
| 浅色/深色变量模式 | 映射为资源模式或主题分支 |
| 位图/矢量素材 | 内容哈希去重后写入资源目录 |
| 页面跳转 | 生成导航意图、路由占位或用户指定的路由适配器 |
| Overlay / Modal | 映射为 Dialog、Sheet 或项目现有弹层组件 |
| Change to variant | 映射为局部状态变更 |
| Smart Animate、复杂路径动画 | 标记为未支持，要求用户选择降级方案 |
| 复杂蒙版、混合模式、插件私有节点 | 保留问题记录，不允许静默丢弃 |

### 4.3 设计源适配器

生成引擎不能直接依赖 Figma 数据结构。必须定义统一的 `DesignSourceAdapter`：

```ts
interface DesignSourceAdapter {
  connect(input: DesignSourceConnection): Promise<DesignSourceRef>;
  getDocumentSummary(ref: DesignSourceRef): Promise<DesignDocumentSummary>;
  getNodes(ref: DesignSourceRef, nodeIds: string[]): Promise<DesignNode[]>;
  getVariables(ref: DesignSourceRef): Promise<DesignVariableCollection>;
  exportAssets(ref: DesignSourceRef, requests: AssetRequest[]): Promise<AssetResult[]>;
  renderReference(ref: DesignSourceRef, nodeIds: string[]): Promise<ReferenceRender[]>;
  getVersion(ref: DesignSourceRef): Promise<DesignSourceVersion>;
}
```

Figma 是第一个适配器。以后接入 MasterGo、Pixso 或本地交换包时，不改变规范化模型、生成器和工作区 UI。

## 5. 入口与导航

### 5.1 主入口

在右侧工作区的“打开工具”菜单中新增：

- 图标：组件、钢笔或布局类图标。
- 名称：`设计转鸿蒙`。
- 内部 id：建议使用 `design`，避免把产品名称写进大量布局代码。
- 位置：在“浏览器”和“鸿蒙设备”之间，或者紧邻“鸿蒙设备”。

具体接入点：

- `components/workspace/RightPanel.tsx`
  - 扩展 `RightPanelTab`。
  - 在 `TOOLS` 中加入 `design`。
  - 增加对应 `tabpanel`。
  - 重型工作台应延迟加载。
- `components/AppShell.tsx`
  - 恢复和持久化 `design` 标签。
  - 加入命令面板动作。
  - 向工作台传递当前项目、当前会话、打开文件、打开审阅和引导 Agent 的回调。
- `lib/i18n/messages/en.ts` 和 `lib/i18n/messages/zh-CN.ts`
  - 增加入口、状态、错误和操作文案。

### 5.2 次入口

1. 新项目空白页增加“从设计稿开始”启动卡片。它只打开设计工作台，不创建假的会话。
2. 命令面板增加“打开设计转鸿蒙”。
3. 在鸿蒙设备面板完成连接后，可以提供“验证设计生成页面”的上下文入口。
4. 设置中增加“设计转代码”页面，用于设计源凭据、缓存、默认目标模块和预览工程设置。

### 5.3 明确不放的位置

- 不放进左侧 SessionSidebar。左侧仍只管理项目、任务和会话。
- 不把它做成 ChatInput 的 Goal/Plan 类模式。
- 不把完整功能塞进 HarmonyPanel。鸿蒙设备只是验证目标，设计工作台可以在没有设备时完成导入、规划和代码生成。

## 6. 工作台界面

### 6.1 总体布局

设计工作台使用现有右侧工具标签和最大化机制。

分栏状态用于边看设计边与 Codex 对话；最大化状态用于浏览完整文件、检查映射和视觉差异。最大化时提供“返回对话”按钮，它退出最大化并聚焦现有 ChatInput，不创建第二套聊天输入框。

工作台分为五个区域：

1. 顶部来源与运行栏。
2. 左侧设计文档树。
3. 中间设计画布或验证画布。
4. 右侧生成检查器。
5. 底部可折叠的产物、日志和问题抽屉。

### 6.2 顶部来源与运行栏

从左到右显示：

- 设计源图标、文件名称和同步版本。
- “重新同步”按钮。
- 视图切换：设计、映射、代码、对比。
- 目标选择：Phone、Tablet、Foldable 和 API Profile。
- 目标模块选择，仅在项目存在多个 Harmony 模块时出现。
- 主按钮：`分析所选范围`、`生成所选流程`、`验证`或`应用到项目`，根据状态只显示一个主动作。

“生成”只生成到隔离预览区；“应用到项目”是唯一写入用户项目的动作。

### 6.3 左侧设计文档树

树分组显示：

- 页面和 Section。
- 可生成的 Frame、流程入口和页面画板。
- 组件库和 Component Set。
- 设计变量和变量模式。
- 原型流程。

支持多选、按流程选择和搜索。选择一个流程时，系统自动选中它能到达的页面；选择页面时，系统自动计算组件、变量和素材依赖，但依赖项只显示为“自动包含”，不混入用户选择。

### 6.4 中间画布

提供四种视图：

- 设计：展示设计稿的完整页面关系和画板。
- 映射：在节点上显示将生成的 ArkUI 组件和目标文件。
- 代码：显示当前节点对应的 ArkTS 产物，只读预览；编辑仍进入现有文件工具。
- 对比：展示设计参考图与真机/模拟器画面的并排、叠加滑杆和差异区域。

首版不实现自由编辑设计稿。工作台是导入、选择、映射和验证工具，不是新的 Figma。

### 6.5 右侧生成检查器

检查器包含：

- 当前选择范围和自动依赖。
- 设计组件到项目组件、原生 ArkUI 或新生成组件的映射。
- 设计变量到 Harmony 资源的映射。
- 页面跳转和交互映射。
- 尚未定义的数据属性与回调。
- 未支持能力和建议降级方案。
- 目标文件、生成所有权和手工修改状态。

问题按严重程度分为：

- 阻塞：不确认就不能生成，例如目标模块缺失或组件映射冲突。
- 需要确认：系统有默认建议，但可能影响行为。
- 提醒：可以生成，但存在视觉或平台差异。

### 6.6 底部抽屉

抽屉标签：

- 产物：新增、修改、删除的文件；首版不允许设计生成流程删除用户文件。
- 构建：隔离预览工程的构建输出。
- 问题：生成、编译和设备验证问题。
- 同步：设计版本变化和受影响节点。

每个文件都可以调用现有 `onOpenFile` 在文件工具中打开。准备应用时调用现有审阅工作区查看补丁。

### 6.7 响应式行为

- 宽窗口：聊天和设计工作台分栏，或最大化工作台。
- 中等窗口：右侧工作台作为覆盖层，保留最大化按钮。
- 窄窗口：文档树、画布、检查器变为标签页；主动作固定在工具栏中，但不能遮挡内容。
- 低高度窗口：底部抽屉默认关闭。
- 所有树、标签和选择器必须支持键盘操作、可见焦点和屏幕阅读器标签。

## 7. 用户流程

### 7.1 首次连接

1. 用户打开当前 Harmony 项目。
2. 打开“设计转鸿蒙”。
3. 选择 Figma 并完成凭据设置。
4. 粘贴文件或节点链接。
5. Piora 拉取文件摘要、页面树、组件索引和变量索引。
6. 用户选择页面、流程或组件集合。
7. Piora 分批拉取所需节点和依赖，避免一次加载整个大型文件的所有细节。
8. 工作台进入“已分析”状态。

### 7.2 分析与映射

1. 规范化设计节点。
2. 扫描当前 Harmony 项目结构和已有组件。
3. 匹配同名组件、显式映射和设计变量。
4. 生成 UI 计划，而不是直接生成源码。
5. 展示阻塞问题、建议映射和目标文件。
6. 用户确认组件复用、路由、数据属性和降级方案。

### 7.3 生成与验证

1. 将 UI 计划转换为内部 ArkUI AST。
2. 稳定打印 ArkTS、资源文件和生成清单。
3. 写入 Piora 管理的隔离预览目录，不修改项目。
4. 运行静态检查和预览工程编译。
5. 如果有设备能力，安装、启动并截取指定页面。
6. 将设计源渲染出的参考图与设备截图对齐。
7. 展示差异区域以及对应的设计节点和生成组件。
8. 用户可要求 Codex 根据选中节点修正，或手动调整映射后重新生成。

### 7.4 应用到项目

1. 计算预览产物相对当前项目的补丁。
2. 检测项目文件自分析以来是否变化。
3. 检测生成文件是否被手工修改。
4. 在审阅面板展示全部变更。
5. 用户明确选择“应用到项目”。
6. 使用原子写入更新文件，失败时保持项目原状或回滚本次写入。
7. 刷新文件与 Git 状态。
8. 在真实项目中执行一次编译验证。

### 7.5 设计稿更新

1. 获取新版本并与上次快照比较。
2. 按稳定节点 id、组件 key、变量 id 和内容哈希识别变化。
3. 计算受影响页面和依赖闭包。
4. 只重新生成受影响文件。
5. 未变化的输出必须保持字节级稳定。
6. 如果受影响的托管文件被手工修改，阻止覆盖并要求用户选择：保留并脱离托管、查看冲突、覆盖。

## 8. 生成代码的所有权模型

生成产物必须区分两种状态：

### 8.1 托管同步模式

- 文件由设计同步器维护。
- 清单保存来源节点、来源版本、生成器版本和输出哈希。
- 用户手工修改后会被检测为冲突。
- 适合需要持续与设计稿同步的页面和基础视觉组件。

### 8.2 脱离托管模式

- 用户可以把一个页面或组件“转为手工维护”。
- 转换后仍保留普通 ArkTS 代码，但不再被设计同步更新。
- 其他托管页面可以继续把它当作项目组件复用。

默认生成目录建议隔离，例如：

```text
entry/src/main/ets/design_generated/
entry/src/main/resources/base/media/design_generated/
entry/src/main/resources/base/element/design_generated_*.json
```

项目集成层、路由注册和业务数据适配器应尽量放在用户拥有的文件中；生成器只创建一次模板，之后不覆盖。

## 9. 技术架构

```text
DesignSourceAdapter
        │
        ▼
DesignDocumentSnapshot ── source diff / cache
        │
        ▼
NormalizedDesignIR ────── validation / unsupported issues
        │
        ▼
HarmonyUiPlan ─────────── component, token, route, state mappings
        │
        ▼
ArkUiAst + AssetPlan ─── deterministic printer
        │
        ▼
Isolated Preview Workspace
        │
        ├── compile validation
        ├── patch preview
        └── device launch → screenshot → visual diff
        │
        ▼
Explicit Apply → user project
```

### 9.1 原则

- 设计源解析、规范化、规划、生成、写入和验证必须是不同模块。
- 大模型不能成为设计文件解析器，也不能直接决定任意文件写入。
- 对确定性的布局、资源命名和代码格式使用规则和 AST 打印器。
- Codex 只用于处理模糊语义、提出组件复用建议、解释问题和辅助修复。
- 所有模型建议必须变成可检查的 `HarmonyUiPlan` 变化，不能绕过计划直接写项目。
- 所有长任务都有 run id、revision、取消能力和 SSE 进度。
- Next 热更新期间的活动运行注册表放在 `globalThis`，持久状态写入磁盘；不得只使用普通模块级 Map。
- 来自旧运行的迟到事件必须用单调 revision 丢弃，不能覆盖新运行状态。

### 9.2 核心数据对象

`DesignSourceRef`

- provider、file key、可选 node id、显示名称。
- 凭据引用，不包含原始 token。

`DesignDocumentSnapshot`

- 来源版本、页面摘要、节点索引、组件索引、变量索引、素材索引。
- 只保存生成所需字段，不持久化无关插件私有数据。

`NormalizedDesignIR`

- 与设计工具无关的节点、布局、样式、变量、组件、实例和交互模型。
- 每个节点保留稳定来源 id 和来源路径。

`HarmonyUiPlan`

- 生成目标、组件映射、变量映射、路由映射、数据属性、回调、降级选择和问题列表。
- 可序列化、可比较、可人工编辑。

`DesignGenerationRun`

- run id、项目根、设计快照版本、目标节点、状态、revision、开始/结束时间、产物和错误。

`GeneratedArtifactManifest`

- 来源节点到文件和符号的映射。
- 生成器版本、源哈希、基线输出哈希和当前文件哈希。

`ValidationResult`

- 静态、编译、设备、视觉四个阶段的独立结果。
- 视觉差异必须关联来源节点和目标组件，不能只有全局分数。

### 9.3 运行状态机

```text
idle
  → importing
  → analyzing
  → needs_input | planned
  → generating
  → generated
  → validating
  → ready_to_apply
  → applying
  → applied

任一运行态 → cancelling → cancelled
任一阶段可进入 failed，修正后从该阶段重试
```

状态持久化时，进程重启前的 `importing`、`generating`、`validating`、`applying` 必须恢复为 `interrupted`，不能显示为仍在运行。

## 10. 服务端模块建议

```text
lib/design-to-harmony/
  types.ts
  source-adapter.ts
  figma-adapter.ts
  source-cache.ts
  normalize.ts
  validate-ir.ts
  project-analyzer.ts
  component-mapper.ts
  token-mapper.ts
  interaction-mapper.ts
  ui-plan.ts
  arkui-ast.ts
  arkui-printer.ts
  asset-planner.ts
  preview-workspace.ts
  build-adapter.ts
  run-store.ts
  run-registry.ts
  patch-builder.ts
  apply.ts
  visual-diff.ts
  errors.ts

app/api/design-to-harmony/
  sources/figma/connect/route.ts
  imports/route.ts
  imports/[id]/route.ts
  runs/route.ts
  runs/[id]/route.ts
  runs/[id]/events/route.ts
  runs/[id]/generate/route.ts
  runs/[id]/validate/route.ts
  runs/[id]/apply/route.ts
  runs/[id]/cancel/route.ts
  runs/[id]/preview/route.ts
  projects/config/route.ts
  mappings/route.ts

components/workspace/design-to-harmony/
  DesignToHarmonyPanel.tsx
  DesignSourceSetup.tsx
  DesignDocumentTree.tsx
  DesignCanvas.tsx
  DesignMappingCanvas.tsx
  DesignInspector.tsx
  DesignIssues.tsx
  DesignArtifactDrawer.tsx
  DesignVisualCompare.tsx
  DesignRunStatus.tsx
  DesignToHarmonyPanel.module.css

hooks/
  useDesignToHarmonyRun.ts
  useDesignDocumentTree.ts
  useDesignVisualCompare.ts
```

## 11. API 约定

| 接口 | 用途 | 关键要求 |
| --- | --- | --- |
| `POST /api/design-to-harmony/sources/figma/connect` | 验证凭据与来源 | 不返回 token；限制 provider 和 URL 格式 |
| `POST /api/design-to-harmony/imports` | 导入文件摘要或指定节点 | 支持 idempotency key、取消和缓存 |
| `GET /api/design-to-harmony/imports/[id]` | 读取导入结果 | 返回规范化摘要，不返回无关原始数据 |
| `POST /api/design-to-harmony/runs` | 创建分析运行 | 固定 source revision、project root 和 target ids |
| `GET /api/design-to-harmony/runs/[id]` | 获取当前快照 | 包含单调 revision |
| `GET /api/design-to-harmony/runs/[id]/events` | SSE 进度 | 发送 revision、阶段、进度和可恢复错误 |
| `POST /api/design-to-harmony/runs/[id]/generate` | 写入隔离预览区 | 不允许写用户项目 |
| `POST /api/design-to-harmony/runs/[id]/validate` | 静态、编译或设备验证 | 验证阶段由 body 明确指定 |
| `POST /api/design-to-harmony/runs/[id]/apply` | 应用补丁 | 必须带 expected revision 和用户确认产生的 apply token |
| `POST /api/design-to-harmony/runs/[id]/cancel` | 取消运行 | AbortSignal 必须传到底层网络、导出、构建和设备操作 |
| `GET /api/design-to-harmony/runs/[id]/preview` | 获取产物和补丁摘要 | 资源读取受 run 和项目授权约束 |

所有写接口使用有界 JSON 解析、严格 schema 校验和统一错误对象。错误至少包括 `code`、`message`、`stage`、`retryable` 和不含秘密的 `details`。

## 12. 存储与安全

### 12.1 本地数据

运行数据放在 Piora 桌面数据目录下，例如：

```text
<PIORA_DESKTOP_DATA_DIR>/design-to-harmony/
  credentials/
  cache/
  snapshots/
  runs/<run-id>/
  previews/<run-id>/
```

不要把设计访问 token、完整源文件快照和用户设计素材写入会话 JSONL、日志或 Git 仓库。

项目可以选择保存一份可提交的映射配置，例如 `piora.design-to-harmony.json`。该文件只包含来源标识、组件映射、变量映射和生成规则，不包含凭据或完整设计数据。

### 12.2 安全要求

- 设计源 token 只通过独立凭据存储访问，API 状态永远不返回原文。
- 设计链接由适配器解析，不能把任意 URL 当作下载地址，防止 SSRF。
- 素材下载只允许来源适配器返回的受信域名，并限制单文件和总大小。
- SVG 在写入或预览前进行安全清理。
- 所有目标路径必须解析后验证仍在预览根或明确的项目根中。
- 项目外预览目录调用现有 allow-list 边界使文件工具可读，但不能因此开放上级目录。
- 构建命令必须使用固定可执行文件和参数数组，禁止拼接用户输入到 shell 字符串。
- 设计生成流程不删除用户文件。需要清理旧托管资源时，必须先在补丁中明确显示并单独确认。
- apply 使用临时文件和原子替换；多文件应用失败时提供事务清单和可恢复回滚。
- Figma 或其他设计源的限流、超时和重试必须有上限，不能无限自动重试。

## 13. 预览、构建与设备验证

### 13.1 隔离预览

生成器先写入独立预览工作区。预览工作区由 Piora 管理，包含：

- 从目标项目读取的只读上下文或最小复制。
- 生成的 ArkTS 与资源。
- 生成清单和补丁基线。
- 构建输出和验证产物。

首版可以采用最小预览工程；当需要复用当前项目组件时，使用受控的影子工作区或临时工作树。无论采用哪一种方式，不能为了预览先修改用户当前 checkout。

### 13.2 构建适配器

Harmony 构建命令和参数随项目、SDK 与 DevEco 环境变化。实现时必须检查目标项目现有 wrapper、配置文件和当前 SDK 文档，不能把训练记忆中的命令写死。

构建适配器职责：

- 检测项目根、模块、product、build mode 和 SDK。
- 使用项目自己的 wrapper 或明确配置的 DevEco 工具链。
- 使用绝对可执行路径和参数数组。
- 限制运行时间与输出大小。
- 将诊断映射回生成文件和来源节点。
- 支持取消并清理自己创建的子进程。

### 13.3 设备验证

设备验证复用现有 Harmony 子系统的设备发现、租约、启动、截图、UI 树和 SSE 能力。设计工作台不直接复制一套 HDC 管理器。

验证步骤：

1. 编译预览或目标工程。
2. 安装并启动指定 bundle/ability。
3. 导航到测试页面；必要时使用生成的测试入口。
4. 等待画面稳定。
5. 同时采集截图和 UI 树。
6. 裁切或遮罩状态栏、导航区等非设计区域。
7. 与设计源的参考渲染对齐并计算差异区域。
8. 差异区域关联到 UI 树节点、ArkUI 组件和设计节点。

设备不可用时，静态分析、代码生成和编译验证仍可使用。

## 14. Codex 运行时协作

MVP 不新增 ChatInput 模式。工作台提供“交给 Codex”动作：

- 退出最大化并聚焦现有 ChatInput。
- 插入当前 run id、来源节点、问题摘要、目标文件和预览清单路径。
- 用户可以继续补充自然语言后发送。

第一版只把已选择的结构化摘要交给 Codex，不把完整设计文件或凭据写入提示。

后续可增加普通第一方扩展工具，让 Agent 读取设计运行上下文、提出计划和触发隔离生成。`apply` 仍必须经过工作台确认，扩展工具不能绕过用户批准直接覆盖项目。

## 15. 开发计划

每一阶段单独完成设计、实现、单元测试、集成测试和手工验收；不要一次提交全部功能。

### 阶段 0：契约与样例冻结

实现内容：

- 冻结 `DesignSourceAdapter`、`NormalizedDesignIR`、`HarmonyUiPlan` 和 run 状态机。
- 建立完全自有的设计 fixture，不使用客户设计稿。
- 准备最小、多页面、组件变体、变量主题、复杂布局和不支持能力样例。
- 准备至少两个小型 Harmony 示例工程或可验证的生成目标配置。

完成条件：

- fixture 可以稳定序列化。
- 支持矩阵和降级行为都有预期结果。
- 尚未增加产品入口和项目写入。

### 阶段 1：只读导入与文档树

实现内容：

- Figma 适配器、凭据边界、缓存和限流。
- 只读导入 API。
- Design 工作区入口、空状态、文件连接和设计文档树。
- 大文件按摘要和所选节点延迟加载。

完成条件：

- 能浏览完整文件的页面、流程、组件和变量。
- 不生成代码、不写用户项目。
- 断网、过期凭据、限流和取消都有明确状态。

### 阶段 2：规范化 IR 与生成计划

实现内容：

- 规范化器、验证器、项目扫描器。
- 组件、变量、交互映射器。
- 生成检查器和问题解决 UI。
- 计划持久化、版本固定和增量 diff 基础。

完成条件：

- 同一设计快照重复分析得到相同计划。
- 不支持的设计能力全部可见，没有静默丢弃。
- 计划还不能写用户项目。

### 阶段 3：确定性 ArkUI 生成器

实现内容：

- ArkUI AST、稳定打印器和资源规划器。
- 隔离预览目录和产物清单。
- 设计节点到文件、符号和资源的来源映射。
- 代码与产物预览。

完成条件：

- fixture 的输出可做 golden test。
- 重复生成字节级稳定。
- 生成只发生在预览目录。

### 阶段 4：补丁审阅与安全应用

实现内容：

- 当前项目与预览产物的补丁构建。
- 与现有 ReviewPanel 和 FileViewer 的集成。
- expected revision、手工修改检测、冲突 UI 和原子应用。
- 托管与脱离托管状态。

完成条件：

- 未确认时项目零写入。
- 运行期间项目发生变化会阻止陈旧补丁应用。
- 手工修改不会被静默覆盖。
- 应用失败可以恢复到应用前状态。

### 阶段 5：编译与设备视觉闭环

实现内容：

- Harmony 项目/SDK 检测和构建适配器。
- 构建日志、诊断定位和取消。
- 复用 Harmony 设备系统进行安装、启动、截图和 UI 树采集。
- 设计参考渲染、对齐、遮罩、叠加滑杆和差异区域。

完成条件：

- 支持 fixture 的生成结果全部能在声明的 SDK 矩阵中编译。
- 设备验证不会破坏现有 Harmony 租约和旁观模式。
- 视觉问题能定位到设计节点和生成文件。

### 阶段 6：增量同步与生产硬化

实现内容：

- 设计版本差异、依赖图和最小重生成。
- 断点恢复、缓存回收、并发控制和大文件性能优化。
- 完整中英文文案、无障碍和产品引导。
- 可选的 Agent 扩展工具和“交给 Codex”上下文。

完成条件：

- 只修改一个组件时只影响其依赖页面。
- 中断后的运行显示 `interrupted`，可以安全重试。
- 发布前关闭开发实验门或明确标为 Beta。

## 16. 测试策略

### 16.1 单元测试

使用项目现有 `node:test` 风格，重点测试纯模块：

- 设计节点规范化和默认值。
- Auto Layout、约束、Stack 和尺寸策略映射。
- Component Instance 和 Variant 覆盖。
- 变量模式与资源名生成。
- 名称清理、冲突消解和稳定排序。
- 素材内容哈希与去重。
- 原型交互映射与不支持问题。
- 依赖闭包和增量影响范围。
- ArkUI AST 打印器 golden 输出。
- 清单哈希、手工修改检测和冲突判定。
- 运行状态 reducer、revision 和迟到事件过滤。
- 路径安全、URL 约束、大小上限和秘密脱敏。

建议测试文件：

```text
lib/design-to-harmony-normalize.test.mjs
lib/design-to-harmony-mapping.test.mjs
lib/design-to-harmony-generator.test.mjs
lib/design-to-harmony-assets.test.mjs
lib/design-to-harmony-run-store.test.mjs
lib/design-to-harmony-apply.test.mjs
lib/design-to-harmony-security.test.mjs
```

### 16.2 API 与集成测试

- 使用 fake adapter，不依赖真实 Figma 网络。
- 导入、取消、失败重试和缓存命中。
- SSE 断线重连、revision 恢复和终止事件。
- 同一个幂等键不会创建两次运行。
- 预览目录与项目目录边界。
- apply token、expected revision 和陈旧补丁拒绝。
- 进程重启后的 `interrupted` 恢复。
- 源限流、超时和资源下载失败。
- 凭据和设计内容不会进入日志或 API 状态。

真实 Figma 测试作为显式 opt-in 测试，使用专门的测试文件和短期凭据，不进入默认 CI。

### 16.3 组件与无障碍测试

- RightPanel 工具入口和恢复逻辑。
- 文档树的键盘选择、多选和搜索。
- 设计/映射/代码/对比标签语义。
- 阻塞问题、确认问题和提醒状态。
- 长文件名、中文节点名、Emoji、RTL 文本。
- 320px、窄右栏、覆盖模式和最大化布局。
- 焦点从工作台返回 ChatInput。
- 加载、空、失败、取消、离线和凭据过期状态。

现有源码结构断言只能保护接线；关键交互应增加浏览器级测试，不应只依赖正则匹配组件源码。

### 16.4 Golden 与编译测试

每个 fixture 包含：

- 规范化 IR 预期。
- UI Plan 预期。
- ArkTS 与资源输出预期。
- 不支持问题预期。
- 可选的设计参考渲染。

对支持范围内的 fixture，生成项目必须在声明的 Harmony SDK 矩阵中编译成功。SDK 相关测试可在具备 DevEco 环境的专用 CI 或手工验收机运行，不把 SDK 二进制提交到仓库。

### 16.5 真机验收

- 至少一台 Phone 和一个不同尺寸目标。
- 浅色与深色主题。
- 中英文、动态长文本和系统字体差异。
- 状态栏、导航区、安全区域和键盘弹出。
- 页面跳转、返回、弹层、滚动和点击状态。
- 设计稿更新后的最小重生成。
- Agent 操作设备时工作台保持旁观，不抢占租约。

### 16.6 性能与稳定性

- 10,000 个节点的文件摘要加载。
- 100 个画板、500 个组件实例的选择和依赖计算。
- 资源总量、单资源大小和并发下载上限。
- 连续取消、重新生成和快速切换项目。
- Next 热更新、Piora 重启和 SSE 重连。
- 缓存清理时不删除活动运行和用户项目内容。

## 17. 验收标准

MVP 必须同时满足：

1. 能导入完整结构化设计文件并浏览页面、组件、变量和流程。
2. 能选择多个页面或一个完整流程，并自动补齐依赖。
3. 能展示所有未支持能力和需要确认的映射。
4. 同一输入和配置重复生成得到相同输出。
5. 生成阶段不修改当前项目。
6. 所有支持 fixture 的输出通过 ArkTS 编译验证。
7. 应用前能在审阅中看到完整补丁。
8. 陈旧项目、手工修改和映射冲突会阻止应用。
9. 用户明确确认后才写项目，并且失败可恢复。
10. 设备可用时能完成启动、截图和设计对比；设备不可用时其他流程正常。
11. 设计凭据不出现在日志、API 响应、会话或项目文件中。
12. `npm test`、类型检查和 lint 全部通过。

## 18. Codex 实施清单

Codex 在每个阶段开始前必须：

1. 完整阅读仓库 `AGENTS.md`。
2. 检查 `git status`，保留用户已有改动。
3. 在修改 Next.js 代码前阅读 `node_modules/next/dist/docs/` 中与该阶段相关的文档。
4. 只实现当前阶段，不提前混入后续阶段。
5. 先写纯类型和纯函数测试，再接 UI 和路由。
6. 使用 fake design adapter 完成默认测试，真实服务只做 opt-in 验收。
7. 所有文件编辑使用小而可审查的补丁。
8. 长运行提供取消和超时，秘密信息在进入日志前脱敏。
9. 写项目前验证绝对路径、项目 revision 和 apply token。
10. 复用现有 Review、Files、Harmony、SSE、确认对话框和 i18n 基础设施，不复制平行子系统。

每个阶段完成后依次执行：

```bash
node --test <本阶段新增和直接相关的测试>
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

手工界面验证使用：

```bash
npm run dev
```

开发期间禁止运行 `next build`。开发服务器端口为 30141。

每阶段交付说明必须包含：

- 本阶段完成了什么。
- 没有实现什么。
- 修改的状态、接口和文件边界。
- 自动测试结果。
- 手工测试步骤和结果。
- 已知限制和下一阶段入口。

## 19. 发布策略

开发阶段使用明确的实验门控制入口，避免半成品进入普通用户工具列表。阶段 1 至阶段 4 可以标记为“Beta”，但必须保留“只生成到预览区”的安全边界。

首个可公开版本建议只宣传：

> 导入完整 Figma 设计文件，选择页面或流程，生成并审阅可编译的鸿蒙 ArkUI 页面。

增量同步、真机自动修正和更多设计源在分别通过验收后再宣传，不能用路线图能力描述当前产品能力。
