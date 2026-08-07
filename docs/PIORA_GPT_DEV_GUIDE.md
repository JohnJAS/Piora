# Piora 开发指导文档（面向 GPT / Codex 实施 Agent）

> 版本：v1.0 ｜ 基线：`b8d7e69` ｜ 编写日期：2026-08-07
> 上游设计依据：`docs/PIORA_DESIGN_SPEC.md`
> 项目内部规则：`AGENTS.md`（**必读，优先级高于本文档的风格建议**）

---

## 第 0 章：给实施 Agent 的硬性约束

### 0.1 开工前必读

```
1. AGENTS.md                          — 架构、陷阱、会话文件格式
2. docs/PIORA_DESIGN_SPEC.md § 1.6    — 能力归属矩阵 ★最重要
3. docs/PIORA_UI_STYLE_SPEC.md        — 视觉规范 ★写任何样式前必读
4. docs/PIORA_DESIGN_SPEC.md          — 目标形态与完成度标尺
5. 本文档第 3 章中你要做的那个任务包
```

### 0.1.1 本项目的根本约束：**不给 pi Agent 加功能**

Piora 是 pi Agent 的 GUI，不是 pi 的分支。每个任务包动手前必须先判断归属：

| 归属 | 你要做的 |
|---|---|
| **【接线】** pi 原生已有 | 找到 SDK 符号 → 订阅/调用/渲染。**禁止自造实现。** |
| **【GUI】** 工作台自身能力 | 自由实现，不碰 pi |
| **【降级】** pi 模型不支持 | 按 pi 的特性改需求，**不改 pi** |

判断依据在 `docs/PIORA_DESIGN_SPEC.md § 1.6` 的逐项归属表（基于 `pi-coding-agent@0.83.0` 的 `.d.ts` 实测）。

**动手前的自检**：如果你正准备写一个「工具分类器」「diff 计算」「审批网关」「命令注册表」「会话终态判断」—— **停下**，先去 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` 和 `core/tools/edit-diff.d.ts` 里搜一遍。这五样 pi 全都有。

### 0.2 绝对禁止（违反即回滚）

| 禁止 | 原因 |
|---|---|
| 开发期运行 `next build` / `npm run build` | 污染 `.next/`，`npm run dev` 会崩。构建只在停掉 dev server 后做 |
| 把 AgentSession 存进模块级 `Map` | Next 热重载会丢，必须用 `globalThis.__piSessions` |
| `fork()` 后不 `destroy()` wrapper | wrapper 内部状态被原地改写，后续 fork 会产生损坏的 `parentSession` 链 |
| 绕过 `lib/normalize.ts` 直接用 toolCall 字段 | 文件格式 `{id,name,arguments}` 与内部类型 `{toolCallId,toolName,input}` 不一致 |
| 新增文件读写 API 不走 `lib/allowed-roots.ts` + `lib/path-security.ts` | 路径穿越 |
| 新增 POST 路由不走 `lib/bounded-json.ts` / `lib/bounded-form-data.ts` | 请求体炸内存 |
| 用 id 判断 Provider 能力 | 必须用 `lib/provider-listing.ts` 的能力驱动判断，SDK 版本间会变 |
| 新 UI 文案只写英文 | 必须同时写 `lib/i18n/messages/en.ts` 和 `zh-CN.ts` |
| 硬编码颜色 | 必须用 `app/globals.css` 的 CSS 变量 |
| 新增 Electron IPC 不加 preload 白名单 | `contextIsolation` 安全模型 |
| 在没有真沙箱时写 "Sandboxed" | 违反产品原则 P3 |
| 新增桌宠 / 主题包 / 背景能力 | 冻结期（见设计规格第 5 章） |
| **自己实现 pi 已有的能力** | 见 § 0.1.1；工具分类、diff 计算、审批拦截、命令注册、会话终态判断 pi 全都有 |
| **修改 `node_modules/@earendil-works/*`** | Piora 是 GUI，不是 pi 的分支。需要 pi 改动 → 提 issue 给上游，不要本地打补丁 |
| 引入 `node-pty` / `@xterm/xterm` | pi 的 bash 无 stdin，PTY 不符合本项目定位（见 T-20） |

### 0.3 每次改动的标准流程

```bash
# 1. 起 dev（保持运行，不要在此期间 build）
npm run dev            # http://127.0.0.1:30141

# 2. 改代码

# 3. 三件套（必须全绿才能提交）
npm run typecheck
npm run lint
npm test

# 4. 浏览器实测：鼠标 + 键盘 + 错误态，控制台零新增错误

# 5. 阶段收尾时（先 Ctrl+C 停 dev）
npm run build:app && npm run verify:package && npm run smoke:portable
```

### 0.4 提交规范

```
<type>: <祈使句，不超过 60 字符>

- 具体改了什么
- 为什么这么改（如果不显然）

type ∈ feat | fix | refactor | perf | test | docs | chore
```
一个提交只做一件事。拆分类重构（如拆 2000 行组件）必须**独立提交**，不夹带功能改动。

### 0.5 测试写法

本项目用 Node 原生测试，**不用 Jest / Vitest**：

```js
// lib/task-status.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTaskStatus } from "./task-status.ts"; // 见现有 .test.mjs 的导入方式

test("running 会话产出 runtime=running", () => {
  const s = deriveTaskStatus({ id: "a", runningIds: new Set(["a"]) });
  assert.equal(s.runtime, "running");
});
```

**规则**：所有新增的**纯函数**必须有同名 `.test.mjs`。React 组件测试参考现有 `components/*.test.mjs` 的做法（多为对渲染输出/行为断言的轻量测试，不引入 DOM 框架）。

---

## 第 1 章：代码地图（改动落点速查）

```
app/
  layout.tsx                 根布局（lang 属性在这里，:57）
  page.tsx                   13 行，只挂 AppShell
  globals.css                2835 行，全部 CSS 变量与布局
  theme-packs/               主题包（冻结）
  api/                       44 个 route.ts
    agent/                   会话运行：new / [id] / [id]/events(SSE) / running
    sessions/                会话读取、重命名、导出、上下文
    git/                     只有 diff、status（写操作待新增）
    models/ models-config/   模型与 Provider
    auth/                    OAuth / API Key
    skills/ plugins/         扩展
    files/ cwd/ file-index/  文件访问（受 allowed-roots 限制）
    worktrees/               git worktree
    companion-pets/          桌宠

components/                  30 个 tsx，见设计规格附录 B
hooks/                       14 个
lib/                         ~70 个模块，绝大多数有同名 .test.mjs
  rpc-manager.ts             AgentSession 注册表（globalThis）★核心
  session-reader.ts          jsonl 读取 + 上下文构建
  normalize.ts               toolCall 字段归一 ★易踩坑
  allowed-roots.ts           文件访问白名单 ★安全
  path-security.ts           路径校验 ★安全
  bounded-json.ts            请求体限流 ★安全
  atomic-file.ts             原子写
  i18n/                      registry + format + messages/{en,zh-CN}.ts

desktop/src/
  main.ts                    829 行，窗口 / 菜单 / 通知 / 生命周期
  server-supervisor.ts       Next standalone 子进程托管
  preload.ts                 41 行，IPC 白名单 ★安全
scripts/                     打包、校验、许可证工具链
```

### 数据流速记

```
新任务：ChatInput → POST /api/agent/new → rpc-manager.startRpcSession()
                                        → createAgentSession() → 返回 sessionId
发消息：ChatInput → POST /api/agent/[id] { type:"prompt" } → session.prompt()
接收：  useAgentSession → GET /api/agent/[id]/events (SSE) → handleAgentEvent()
状态：  SessionSidebar 每 2.5s 轮询 /api/agent/running（页面不可见时暂停）
读历史：GET /api/sessions/[id] → session-reader 直接读 jsonl，不建 AgentSession
```

---

## 第 2 章：通用实现规范

### 2.1 i18n

```ts
// 加 key：两个文件都要加，key 结构保持一致
// lib/i18n/messages/en.ts
"task.status.needsApproval": "Needs approval",
// lib/i18n/messages/zh-CN.ts
"task.status.needsApproval": "等待确认",

// 用：
const t = useI18n();
t("task.status.needsApproval")
// 带参数：
t("review.changeCount", { added: 142, removed: 18 })
```
命名：`<区域>.<子区>.<语义>`，全小驼峰。禁止把英文原文当 key。

### 2.2 CSS

```css
/* 只用变量，不写字面色 */
color: var(--text-muted);
background: var(--bg-panel);
border: 1px solid var(--border);

/* 新增状态色统一在 :root 与各主题块中定义 */
--status-running:   ...;
--status-attention: ...;
--status-failed:    ...;
--status-ready:     ...;
```
新组件优先用 **CSS Module**（`Xxx.module.css`），不要继续往 2835 行的 `globals.css` 里堆。只有跨组件的 token 和布局才进 globals。

### 2.3 无障碍最低要求（每个新组件）

- 交互元素用语义标签（`<button>` / `<a>`），不用可点击 `<div>`；
- 弹层：`role="dialog"` + `aria-modal` + focus trap + Esc 关闭 + 焦点返回；
- 列表/树：正确的 `role` + `aria-expanded` + roving tabindex（一个 tabbable，方向键移动）；
- 状态变化用 `aria-live="polite"`；
- 所有图标按钮必须有 `aria-label`。

### 2.4 布局稳定性（Codex 对齐的硬指标）

**悬停前后行的位置与尺寸必须完全不变。**
做法：悬停操作区用固定宽度容器 + `visibility` 或 `opacity` 切换，**禁止**用 `display:none` ↔ `display:flex`。

### 2.5 新 API 路由模板

```ts
// app/api/xxx/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json";
import { assertPathAllowed } from "@/lib/path-security";   // 涉及路径时
import { isAllowedRoot } from "@/lib/allowed-roots";       // 涉及路径时

export async function POST(req: NextRequest) {
  const body = await readBoundedJson(req, { maxBytes: 64 * 1024 });
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  // 1. 参数校验（显式，不信任前端）
  // 2. 路径/权限校验
  // 3. 执行
  // 4. 统一错误形状 { error: string, code?: string }
}
```
**每个新路由必须配一个 `.test.mjs`，至少覆盖：正常、参数缺失、路径穿越尝试、超大请求体。**

---

## 第 3 章：任务包（按执行顺序）

> 每个任务包是一个独立的、可验收的工作单元。
> **一次只做一个任务包，做完跑完三件套再开下一个。**

---

### 阶段 0：地基清理

---

#### T-01 移除危险删除，增加 Undo

**目标**：会话删除必须二次确认；删除后 5 秒内可撤销。

**涉及文件**：`components/SessionSidebar.tsx:1921-1928`，`app/api/sessions/[id]/route.ts`

**实现步骤**
1. 删除 `handleDeleteClick` 中的 `if (e.shiftKey) { void performDelete(); }` 分支，统一走 `setConfirmDelete(true)`。
2. 删除改为两步：先把 `.jsonl` 移到 `~/.pi/agent/sessions/.trash/<原相对路径>`（用 `lib/atomic-file.ts`），5 秒后或应用退出时真删；期间显示 Undo toast。
3. Undo 调 `POST /api/sessions/[id]/restore`（新增）把文件移回。
4. 注意 `AGENTS.md` 的级联重父：删除时子会话的 `parentSession` 已有处理逻辑，Undo 必须能还原。

**验收**
- [ ] Shift+Click 不再跳过确认
- [ ] 删除后出现 Undo，点击可完整恢复（含子会话关系）
- [ ] 5 秒后 trash 内文件被清理
- [ ] `npm test` 全绿

**禁止**：直接 `unlinkSync` 且无恢复路径。

---

#### T-02 视觉体系对齐 Codex（含对比度修复）

> ⚠️ 本任务包不只是改两个色值。**完整执行 `docs/PIORA_UI_STYLE_SPEC.md` 第 8 章的 S1–S10。**

**目标**：把暖色调 + 18 级字阶 + 多层阴影的现状，收敛成中性灰 + 6 级字阶 + 扁平表面。

**涉及文件**：`app/globals.css`（主战场）、各组件 `.module.css`、`app/theme-packs/`

**执行顺序（一步一提交，不要合并）**

| 步 | 动作 |
|---|---|
| S1 | 替换 Light/Dark 中性灰阶 + 强调色 + 状态色（照抄样式规范 §2 的色值） |
| S2 | 写 `lib/contrast.test.mjs` 锁死对比度 ★先写测试 |
| S3 | 新增 6 级字阶，旧 18 级设为别名（纯别名，视觉无变化） |
| S4 | 删 `--shadow-surface` / `--shadow-control` / inset 高光 / 半透明 token |
| S5 | 圆角 4→3 |
| S6 | 默认字体改 Inter |
| S7 | **取消助手消息气泡背景** ← 视觉变化最大，单独提交 |
| S8 | 取消 `globals.css:2` 的全局 `@import dream-skin` |
| S9 | 6 套装饰主题移入「更多主题」折叠区 |
| S10 | 逐组件迁移到新字阶/间距阶，删旧别名 |

**`lib/contrast.test.mjs` 要求**：解析 `globals.css` 各主题块的 `--bg` / `--bg-panel` / `--text` / `--text-muted` / `--text-dim`，实算 WCAG 对比度并断言 ≥4.5:1。**这个测试是防回归的关键**，必须在 S1 之后立刻写。

**验收**
- [ ] Light/Dark 全部文本对比度 ≥4.5:1，`contrast.test.mjs` 通过
- [ ] 字阶只剩 6 级（旧别名可暂留，S10 后删除）
- [ ] 非浮层元素全库无 `box-shadow`
- [ ] 助手消息无气泡，靠留白分隔
- [ ] 灰度截图后信息层级依然清晰
- [ ] 双主题实测，控制台零新增错误

**禁止**：只改色值不做收敛；在组件里写字面 px 字号或字面色值。

---

#### T-03 `html lang` 跟随 i18n

**涉及文件**：`app/layout.tsx:57`，`hooks/useI18n.tsx`

**实现步骤**
1. `layout.tsx` 是 Server Component，语言在客户端确定 → 在客户端 i18n 初始化时 `document.documentElement.lang = locale`。
2. 保留 `translate="no" className="notranslate"`（防止浏览器翻译干扰代码）。
3. SSR 首帧用一个合理默认（可从 `Accept-Language` 读，或保留 en）。

**验收**
- [ ] 切到中文后 `document.documentElement.lang === "zh-CN"`
- [ ] 无 hydration 警告

---

#### T-04 统一 focus trap

**目标**：所有弹层焦点被圈定，关闭后焦点返回触发元素。

**新增**：`hooks/useFocusTrap.ts`

```ts
export function useFocusTrap(
  ref: React.RefObject<HTMLElement>,
  active: boolean,
  opts?: { initialFocus?: React.RefObject<HTMLElement>; onEscape?: () => void }
): void
```
要求：Tab / Shift+Tab 循环；记录 `document.activeElement` 并在 `active` 变 false 时还原；处理动态内容（用 `MutationObserver` 或每次 Tab 时重新查询可聚焦元素）。

**接入点**（逐个改，一个提交一个）：
`SettingsDialog` / `ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `SessionHistoryDialog` / `ProjectTrustDialog` / `CompanionSettingsDialog` / `DirectoryPicker` / 项目菜单 / 顶栏溢出菜单

**验收**
- [ ] 每个弹层打开后 Tab 不会跑到背景
- [ ] Esc 关闭且焦点回到触发按钮
- [ ] 键盘全程可完成打开→操作→关闭

---

#### T-05 文件树语义化

**涉及文件**：`components/FileExplorer.tsx:237` 附近

**实现步骤**
1. 容器 `role="tree"`，节点 `role="treeitem"` + `aria-expanded`（目录）+ `aria-level` + `aria-selected`。
2. roving tabindex：只有当前项 `tabIndex=0`，其余 `-1`。
3. 键盘：`↑↓` 移动、`→` 展开/进入、`←` 收起/回父、`Home/End`、首字母跳转、`Enter` 打开。
4. 保留现有筛选、Ctrl+P、右键菜单、Git 标记全部行为。

**验收**
- [ ] 纯键盘可遍历并打开任意文件
- [ ] 筛选态下键盘同样可用
- [ ] 现有 `.test.mjs` 全绿

---

#### T-06 布局兜底

**涉及文件**：`app/globals.css:2276-2344`，`lib/panel-layout.ts:13`，`components/AppShell.tsx:1186`

**实现步骤**
1. `.workspace-main` 加 `min-width: 640px`（CSS 层，不依赖拖拽 clamp）。
2. 1280–1439px 断点：右栏改为 `position:absolute` 覆盖层，与左栏互斥（打开右栏自动收起左栏，反之亦然）。
3. `lib/panel-layout.ts` 的 clamp 与 CSS 保持同一组常量（抽成导出常量，两边引用）。

**验收**
- [ ] 1280px 下中央区 ≥640px
- [ ] 拖拽与 CSS 兜底不冲突
- [ ] 各断点无横向滚动条

---

### 阶段 1：骨架

---

#### T-07 三轴任务状态模型 ★核心

**新增**：`lib/task-status.ts` + `lib/task-status.test.mjs`，`hooks/useTaskStatus.ts`

**类型定义（照抄，不要自创）**
```ts
export type Lifecycle = "draft" | "active" | "archived";
export type Runtime   = "idle" | "running" | "compacting" | "stopping";
export type Attention = "none" | "needs_input" | "needs_approval" | "failed" | "unread";
export interface TaskStatus { lifecycle: Lifecycle; runtime: Runtime; attention: Attention; }

export interface TaskStatusInput {
  sessionId: string;
  runningIds: Set<string>;
  compactingIds: Set<string>;
  pendingApprovalIds: Set<string>;
  lastPromptFailed: boolean;
  hasUnreadResult: boolean;
  archived: boolean;
  isViewing: boolean;
}
export function deriveTaskStatus(input: TaskStatusInput): TaskStatus;
```

**派生优先级**（attention 单值，冲突时按此序）
`needs_approval` > `needs_input` > `failed` > `unread` > `none`；`isViewing === true` 时 attention 强制为 `none`。

**服务端配合 —— 优先用 pi 的原生事件，不要靠轮询猜**

pi 已提供精确的生命周期事件（`extensions/types.d.ts:524-560`）：

| pi 事件 | 用途 |
|---|---|
| `agent_start` | `runtime = running` |
| `turn_start` / `turn_end` | 运行进度 |
| `tool_execution_start` / `update` / `end` | 当前在做什么（喂给任务头） |
| `agent_end` | 一轮结束（**不代表真的结束**，可能还有重试/压缩/排队） |
| **`agent_settled`** | 注释原文：*fully settled and no automatic retry, compaction, or queued continuation will run* ← **这才是 `unread` / `ready` 的准确触发点** |
| `session_before_compact` / `session_compact` | `runtime = compacting` |

**这解决了 `AGENTS.md` 里记的那个坑**：「不要在第一个 `agent_end` 就关 SSE，重试/压缩/排队消息会继续同一个逻辑 prompt」。`agent_settled` 就是那个正确的终点信号，**不要再用轮询 + 心跳去凑**。

改动：
- `app/api/agent/running/route.ts` 返回结构从 `string[]` 扩展为
  `{ id: string; runtime: "running"|"compacting"|"stopping"; pendingApproval: boolean }[]`
  （**保留旧字段兼容一个版本**，前端切换后再移除）
- `lib/rpc-manager.ts` 订阅上述事件并记录终态（成功/失败 + 错误摘要）；轮询降级为**兜底**，不再是主信号
- `app/api/agent/running/events/route.ts` 推送同一结构

**展示映射**（唯一来源，禁止各处自定义）
```ts
export const STATUS_PRESENTATION: Record<Attention | "running", {
  colorVar: string; i18nKey: string;
}>;
```

**验收**
- [ ] `task-status.test.mjs` 覆盖全部优先级组合与边界
- [ ] 任务行 / 任务头 / 桌宠三处共用 `STATUS_PRESENTATION`
- [ ] 状态变化 ≤1s 反映到 UI
- [ ] 旧接口兼容期内不破坏现有轮询

---

#### T-08 TaskHeader 组件

**新增**：`components/TaskHeader.tsx` + `.module.css`

**结构**（四槽位，见设计规格 B.2.2）
```
[状态徽标+时长]  [Local/Worktree · 项目 · 分支]  [+N −M (K files)]  [Stop] [⋯]
```

**数据来源**
| 槽位 | 来源 |
|---|---|
| 状态 | `useTaskStatus()`（T-07） |
| 环境 | `lib/worktree.ts` 解析结果 + `/api/project-info` |
| 变更 | `/api/git/status`，运行中 3s 轮询、idle 停止、页面不可见暂停 |
| 操作 | 现有 stop / fork / 导出 / 重命名 逻辑，从 `AppShell.tsx` 抽出 |

**降级顺序**（窄窗口）：变更数 → 环境详情 → 时长 → 只留状态点

**验收**
- [ ] 四槽位点击行为全部正确（变更数 → 打开右栏 Review）
- [ ] 无横向溢出，窄窗口按序降级
- [ ] 轮询在页面不可见时停止（DevTools Network 验证）
- [ ] 中英文文案齐全

---

#### T-09 拆分 SessionSidebar ★大重构

**约束**：这是**纯重构**，行为必须逐项一致。**不得夹带任何功能改动。**

**拆分方案**
```
components/sidebar/
  SidebarShell.tsx     骨架 + 主导航（Projects/Tasks/Activity）+ 底部账户区
  ProjectList.tsx      项目 + worktree 展开
  TaskList.tsx         任务分组与排序
  TaskRow.tsx          单行（状态点 + 标题 + 时间 + 悬停操作区）
  SidebarFooter.tsx    设置入口 / 版本
  useSidebarState.ts   展开态、选中态、滚动位置
```

**做法**
1. 先写一份「现有行为清单」（列出所有交互，约 30 条），作为回归依据；
2. 一次搬一个组件，每次搬完跑 `npm test` + 手动过一遍清单；
3. 状态提升到 `useSidebarState.ts`，子组件尽量纯展示；
4. 文件树与 Git Changes **暂不删除**，等 T-13 右栏就绪后再迁移。

**验收**
- [ ] 行为清单 30 条逐条对齐
- [ ] `SessionSidebar.test.mjs` / `AppShellProjectSwitch.test.mjs` 全绿
- [ ] 单文件均 <500 行
- [ ] diff 中无功能性改动（review 时可逐行确认是搬运）

---

#### T-10 Pin / Archive / 搜索

**新增**：`lib/session-flags.ts` + 测试

**存储**：`~/.pi/agent/piora/session-flags.json`
```json
{ "<sessionId>": { "pinned": true, "archived": false, "pinnedAt": "ISO" } }
```
用 `lib/atomic-file.ts` 原子写 + `proper-lockfile`（已在依赖里）防并发。

**API**：`GET/PATCH /api/sessions/flags`（批量读 / 单条改）

**UI**
- Pin 区置顶于当前项目任务列表上方
- Archived 折叠区，默认收起，显示计数
- 搜索框：过滤 title + cwd + 项目名；`Ctrl+Shift+F` 聚焦；结果高亮匹配片段
- 右键菜单：Pin / Rename / Archive / Duplicate / Copy path / Reveal / Delete

**验收**
- [ ] Pin/Archive 重启后保持
- [ ] 搜索 300 个会话响应 <50ms
- [ ] Archive 有 Undo
- [ ] 并发写不丢数据（写测试模拟）

---

#### T-11 统一 DiffView ★

**新增**：`components/DiffView.tsx` + `.module.css` + `lib/diff-parse.ts` + 测试

> ⚠️ **不要自己实现 diff 计算。** pi 已导出（`core/tools/edit-diff.d.ts`）：
> `generateUnifiedPatch(path, oldContent, newContent, contextLines)`、
> `generateDiffString(old, new, contextLines) → { diff, firstChangedLine }`、
> `computeEditDiff` / `computeEditsDiff`（不落盘预览 edit 的 diff）。
> edit 工具的 diff 本来就是这些函数算的 —— 复用它们，`DiffView` 才会和 pi 的 TUI 显示一致。
> `lib/diff-parse.ts` 只负责**解析 unified diff 文本为渲染结构**，不负责算 diff。

**API**
```ts
interface DiffViewProps {
  patch: string;                       // unified diff
  filePath?: string;
  language?: string;
  mode?: "unified" | "split";
  contextLines?: number;               // 默认 3
  collapsed?: boolean;
  hunkActions?: (hunk: Hunk) => React.ReactNode;  // Review 的块级操作插槽
  onOpenFile?: (path: string, line: number) => void;
}
```

**必备能力**：行号、增删着色、折叠未变更区、语法高亮（复用 `react-syntax-highlighter`）、复制、跳到文件、空 diff / 二进制 / 超大文件的降级提示。

**替换顺序**
1. 先替换 `components/FileViewer.tsx`（约 70 处 diff 相关代码）→ 跑测试 → 提交
2. 再替换 `components/MessageView.tsx`（约 18 处）→ 跑测试 → 提交

**验收**
- [ ] 两处渲染视觉完全一致
- [ ] 超大 diff（>5000 行）不卡死（先做简单截断 + "显示全部" 按钮）
- [ ] `diff-parse.test.mjs` 覆盖：标准 diff、新增文件、删除文件、重命名、二进制、CRLF
- [ ] `MessageView.test.mjs` 全绿

---

#### T-12 工具调用人话化

**新增**：`lib/tool-summary.ts` + 测试

```ts
export interface ToolSummary {
  title: string;          // "编辑 components/TabBar.tsx"
  detail?: string;        // "+12 −3"
  icon: string;           // AliIcon 名
  status: "running" | "ok" | "error";
}
export function summarizeToolCall(
  name: string, input: unknown, result?: unknown, t: Translate
): ToolSummary;
```

**pi 的内置工具就 7 个**（`core/sdk.d.ts` 的 `createXxxTool` 系列）：
`read` `bash` `edit` `write` `grep` `find` `ls`
默认启用的是 `read, bash, edit, write`（`AgentSessionConfig.initialActiveToolNames` 注释）。

**用 pi 的类型守卫，不要用字符串比较工具名**（`extensions/index.d.ts` 导出）：
```ts
import {
  isBashToolResult, isEditToolResult, isReadToolResult, isWriteToolResult,
  isGrepToolResult, isFindToolResult, isLsToolResult, isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
```
这样 `input` / `result` 是强类型（`BashToolInput`、`EditToolInput`…），摘要字段直接取，不用猜 payload 形状。

**兜底**：扩展注册的自定义工具走 `CustomToolCallEvent`（`toolName: string`）→ `title = 工具名`，`detail = 第一个字符串参数的截断`。

**Diagnostics**：原始 `input` / `result` JSON 折叠进二级展开，默认收起，折叠态固定高度 28px。

**验收**
- [ ] 全部内置工具有中英文摘要
- [ ] 未知工具优雅降级
- [ ] 展开/收起不影响滚动位置
- [ ] `tool-summary.test.mjs` 通过

---

#### T-13 新会话空态 starter

**新增**：`lib/starters.ts` + 测试

**信号 → starter 映射**
| 信号 | starter |
|---|---|
| 有未提交变更 | 「审阅当前未提交的改动」 |
| 有 `test/` `__tests__` `*.test.*` | 「为最近改动的文件补测试」 |
| 有 README | 「解释这个仓库的架构」 |
| 有 `package.json` 且有过期依赖 | 「升级依赖并跑通检查」 |
| 恒定 | 「找出并修复一个 bug」 |

取前 5 条，点击**填入 Composer 不发送**。

**数据**：优先复用 `/api/project-info` 与 `/api/git/status`，只在必要时给 `project-info` 加字段。

**验收**
- [ ] 不同项目显示不同 starter
- [ ] 无项目/新目录时有合理默认
- [ ] 点击后可编辑再发送
- [ ] 中英文齐全

---

### 阶段 2：闭环

---

#### T-14 右栏三 tab 骨架 + Files 迁移

**新增**：`components/workspace/RightPanel.tsx`

1. 三 tab：Review / Files / Terminal（Terminal 先显示「即将推出」占位，**或直接不渲染该 tab 直到 T-19 完成** —— 按产品原则 P3，倾向后者）。
2. 把 `FileExplorer` + `FileViewer` 迁进 Files tab，保留全部现有能力。
3. 从 `SessionSidebar` 移除文件树与 Git Changes。
4. tab 状态、宽度、上次活动 tab 持久化到 localStorage。

**验收**
- [ ] 文件相关功能零回归（对照 T-09 的行为清单）
- [ ] tab 有 `role=tablist/tab/tabpanel` + 方向键
- [ ] 左栏不再有文件树

---

#### T-15 Review tab（只读）

**新增**：`components/workspace/ReviewPanel.tsx` + `ChangeList.tsx`

1. 左侧变更列表：按 Staged / Unstaged / Untracked 分组，每项显示状态字母 + 路径 + `+N −M`。
2. 右侧用 `DiffView` 渲染选中文件。
3. 键盘：`Alt+↑/↓` 切文件，`↑↓` 在列表内移动。
4. 数据来自现有 `/api/git/status` + `/api/git/diff`，**本任务不写任何 git 写操作**。

**验收**
- [ ] 变更数与任务头一致
- [ ] 大仓库（>200 变更）列表可用
- [ ] 无变更时有明确空态

---

#### T-16 Git 写操作 API ★安全敏感

**新增**：`app/api/git/{stage,unstage,revert,commit}/route.ts` + `lib/git-write.ts` + 各自 `.test.mjs`

**契约**
```ts
POST /api/git/stage    { cwd, paths: string[] }                    → { ok: true }
POST /api/git/unstage  { cwd, paths: string[] }                    → { ok: true }
POST /api/git/revert   { cwd, paths: string[], diffHash: string }  → { ok: true } | 409 { stale: true }
POST /api/git/commit   { cwd, message, amend?: boolean }           → { ok: true, sha }
```

**强制安全要求**
1. `cwd` 必须通过 `isAllowedRoot()`；`paths` 每一项必须通过 `assertPathAllowed()` 且在 `cwd` 之下（解析 symlink 后再判断）。
2. 请求体走 `readBoundedJson`，`paths` 长度上限 1000。
3. `revert` 必须校验 `diffHash`：服务端重新计算当前 diff 的 hash，不匹配返回 409，前端提示刷新。**防止用户看到的和撤销的不是同一份。**
4. **禁止实现**：`push`、`--force`、`reset --hard`、`clean -fdx`、任意 `git` 参数透传。命令参数必须是白名单拼装，不接受前端传入的 flag。
5. 用 `spawn` 数组参数形式，**绝不用 shell 字符串拼接**。
6. commit message 通过 stdin 或临时文件传入，不进命令行。

**测试必须覆盖**
- [ ] 路径穿越（`../../etc/passwd`、绝对路径、symlink 逃逸）被拒
- [ ] 超长 paths 被拒
- [ ] diffHash 不匹配返回 409
- [ ] 非 git 目录返回明确错误
- [ ] 冲突状态下写操作被拒并说明原因

---

#### T-17 Review tab（可操作）

1. 变更列表加复选框 + Stage/Unstage 按钮（文件级）。
2. `DiffView` 的 `hunkActions` 插槽接入块级 Stage / Revert。
3. Revert **必须二次确认**，弹窗显示将丢弃的行数。
4. Commit 面板：消息输入（多行）、amend 勾选、变更预览、提交后 toast + 变更列表刷新。
5. 所有写操作后刷新 status，并通知任务头更新变更数。

**验收**
- [ ] 文件级 + 块级 stage/unstage/revert 全通
- [ ] Revert 有二次确认且不可误触
- [ ] 提交失败（如 hook 拒绝）有可读错误
- [ ] 操作期间按钮禁用，无重复提交

---

#### T-18 命令面板 + 斜杠命令

**新增**：`lib/commands.ts` + 测试，`components/CommandPalette.tsx`，`hooks/useCommands.ts`，`components/composer/SlashMenu.tsx`

```ts
export interface Command {
  id: string;
  group: "navigate" | "session" | "model" | "panel" | "settings" | "git";
  title: string;                 // i18n key
  keywords?: string[];
  shortcut?: string;
  enabled: (ctx: CommandContext) => true | { reason: string };
  run: (ctx: CommandContext) => void | Promise<void>;
}
```

> ⚠️ **`/` 斜杠命令必须列出 pi 的真实命令，不能自己造一套。**
> pi 有命令注册表：`RegisteredCommand` / `ResolvedCommand` / `SlashCommandInfo` / `SlashCommandSource`
> （`extensions/index.d.ts` + `core/slash-commands.ts`），扩展和 skill 都能通过
> `api.registerCommand(name, options)` 往里注册。
> 正确做法：`lib/commands.ts` 的注册表 = **GUI 自有命令（面板/导航/设置）∪ 从 pi 拉取的命令列表**。
> 后者需要 `rpc-manager` 暴露一个 `get_commands` 通道（pi 侧有 `GetCommandsHandler`）。
> 否则用户装了 skill/扩展，`/` 里却看不到它的命令 —— 那就不是"符合 pi 特性"的 GUI。

**要求**
- ⌘K/Ctrl+K 与 Composer 的 `/` **共用同一注册表**（`/` 只展示子集）。
- pi 侧命令与 GUI 命令在面板中分组显示，来源可见（`SlashCommandSource`）。
- 模糊搜索复用 `lib/file-fuzzy.ts`。
- 最近使用置顶，持久化 localStorage。
- 禁用命令显示原因，不隐藏。
- focus trap（T-04）+ 焦点返回。
- 命令数量首版 ≥25 个，覆盖设计规格 F.2 全部分类。

**验收**
- [ ] `commands.test.mjs`：每个命令的 `enabled` 在各 context 下返回正确
- [ ] 键盘全流程可用
- [ ] `/` 与 ⌘K 行为一致
- [ ] 中英文齐全

---

### 阶段 3：能力

---

#### T-19 审批（**以 pi 扩展实现，不是自建网关**）

> ⚠️ 本任务包已按 SDK 实测重写。**不要在 `lib/rpc-manager.ts` 里写拦截逻辑。**

**pi 侧依据（先读一遍再动手）**
```
node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  :652-683  BashToolCallEvent / ReadToolCallEvent / EditToolCallEvent /
            WriteToolCallEvent / GrepToolCallEvent / FindToolCallEvent /
            LsToolCallEvent / CustomToolCallEvent  ← 已经是分好类的强类型事件
  :778-782  ToolCallEventResult { block?: boolean; reason?: string }
  :851      ExtensionHandler 可返回 Promise ← 可以 await 用户决策
  :885      api.on("tool_call", handler)
  :68-76    ExtensionUIContext.confirm / select / input / notify
```

**新增**：`extensions/piora-approval.ts`（随应用打包的 pi 扩展）+ `lib/approval-policy.ts`（纯策略函数 + 测试）+ `components/ApprovalCard.tsx`

**实现步骤**

1. **不要写工具分类器。** pi 的事件已经按工具分好类了，`event.toolName` 是字面量联合类型，`event.input` 是 `BashToolInput` / `EditToolInput` 等强类型。只需要对 `bash` 做命令模式匹配。

2. `lib/approval-policy.ts`（纯函数，好测）
```ts
export type Tier = "read-only" | "auto-edit" | "full-access";
export type Decision = "allow" | "ask" | "deny";
export function decide(toolName: string, input: unknown, tier: Tier): Decision;
export function matchDangerousCommand(cmd: string): { pattern: string; reason: string } | null;
```
危险命令模式库至少含：`rm -rf`、`del /s`、`format`、`mkfs`、`dd if=`、`curl|wget … | sh`、`git push --force`、`git reset --hard`、`npm publish`、`docker system prune`、写 `~/.ssh`、写系统目录。

3. `extensions/piora-approval.ts`
```ts
export default function (api: ExtensionAPI) {
  api.on("tool_call", async (event, ctx) => {
    const d = decide(event.toolName, event.input, currentTier());
    if (d === "allow") return;
    if (d === "deny")  return { block: true, reason: "当前权限档位不允许该操作" };
    const ok = await ctx.ui.confirm("需要确认", describe(event));
    return ok ? undefined : { block: true, reason: "用户拒绝了该操作" };
  });
}
```

4. **档位用 pi 原生的工具集，不要用扩展硬拦。**
   - Read-only → `createAgentSession({ tools: ["read","grep","find","ls"] })`
   - Auto-edit（默认）→ 默认工具集，扩展只对 `bash` 危险命令询问
   - Full-access → 默认工具集，扩展直接放行（选中需二次确认 + 任务头徽标）

   `lib/tool-presets.ts`（现有 NONE/DEFAULT/FULL）**就是这个模型的雏形**，改名成权限语义并接上档位即可。

5. **前端几乎不用新增管道。** `ctx.ui.confirm()` 走 pi 的 `extension_ui_request`，pi-web 已全链路接通（`lib/rpc-manager.ts:214,676` + `hooks/useAgentSession.ts:722,1129`）。只需把这一类请求渲染成 `ApprovalCard`（允许一次 / 允许本任务 / 拒绝）而不是通用 confirm 弹窗。

6. 扩展的安装：打包时放进应用资源目录，首次运行写入 pi 的扩展发现路径。
   **注意**：`loadExtensionFromFactory` 不在包的 `exports` 里（只有 `.` 和 `./rpc-entry`），所以必须走磁盘文件 + 扩展发现，不能在进程内注册 factory。

**验收**
- [ ] `approval-policy.test.mjs` 覆盖模式库全部条目 + 绕过尝试（大小写、多空格、引号、`&&`/`;` 串联、反引号）
- [ ] 拦截生效：拒绝后 Agent 收到 `reason` 并能继续，不崩
- [ ] 「允许本任务」记忆生效
- [ ] 三档位切换真实改变可用工具（Read-only 下 Agent 确实调不到 edit）
- [ ] 审批挂起时任务状态为 `needs_approval`（联动 T-07）
- [ ] Full-access 需二次确认 + 任务头徽标

**禁止**
- 在 `rpc-manager.ts` 里加拦截分支
- 自己实现 `classifyTool(name, input)` 的通用分类（pi 已按工具分类）
- UI 中出现 "Sandboxed" 字样

---

#### T-20 命令运行面板（**原「PTY 终端」，已按 pi 特性下调**）

> ⚠️ 需求已改。**不做 PTY，不引入 node-pty，不引入 xterm.js。**

**为什么改**
```
node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.d.ts:26
exec: (command, cwd, { onData, signal?, timeout?, env? }) => Promise<{ exitCode }>
```
pi 的 bash 只有输出流，**没有 stdin**。它的模型是「一次性命令 + 流式输出 + 可中断」。做 PTY 就是给 GUI 加一个 pi Agent 没有的东西，不符合本项目定位。

**新增**：`components/workspace/CommandPanel.tsx`，复用 pi 已有的 `!` 用户命令通道

**要求**
| 能力 | 做法 |
|---|---|
| 执行 | 复用 Composer 已有的 `!command` 路径（pi 的 `user_bash`），不新建执行后端 |
| 上下文控制 | `!cmd` 进 LLM 上下文；`!!cmd` 不进（`UserBashEvent.excludeFromContext`） |
| 中断 | 接 pi 的 abort |
| 历史 | 命令历史 + ↑↓ 复原 + 重跑 + 复制输出（GUI 侧，localStorage） |
| 渲染 | `lib/ansi.ts`（已有 ANSI 解析），**不引第三方终端库** |
| 安全 | 只在已 Trust 项目开放；Web/LAN 模式默认关闭 |
| 限制说明 | UI 中明确告知：交互式命令（`vim`、`ssh`、密码输入）不可用 |

**验收**
- [ ] 能跑 `npm test` 并看到实时流式输出
- [ ] 能中断长命令
- [ ] `!!` 的输出确实没进 LLM 上下文（查 jsonl 验证）
- [ ] 未 Trust 项目无法使用
- [ ] 交互式命令的限制在 UI 中可见
- [ ] 打包体积无显著增长

**禁止**：引入 `node-pty` / `@xterm/xterm`；自建 bash 执行后端。

---

#### T-21 Electron 桌面能力

**涉及**：`desktop/src/main.ts`、`desktop-state.ts`、`preload.ts`

按此顺序，**一个提交一项**：
1. 单实例锁（`app.requestSingleInstanceLock()`）+ 第二实例聚焦已有窗口
2. 窗口状态恢复（位置/尺寸/最大化/显示器），拔显示器后回到可见区
3. 原生输入右键菜单（复制/粘贴/全选/撤销）
4. 拖入文件 → 添加为附件（走已有 `lib/file-upload.ts` 校验）
5. Tray 图标 + 运行中任务数 + 菜单（显示 / 新任务 / 退出）
6. 全局快捷键（可在设置中关闭，默认关闭以免冲突）

**安全**：每个新 IPC 通道必须在 `preload.ts` 白名单声明，主进程对参数二次校验，仅接受主 frame + 同源。

**验收**
- [ ] 每项在便携 EXE 中实测通过
- [ ] 多显示器 / DPI 变化不丢窗口
- [ ] `npm run smoke:portable` 通过

---

#### T-22 工作区全文搜索

**新增**：`app/api/search/route.ts`，`components/workspace/SearchPanel.tsx`

- 两种模式：文件名（复用 `lib/file-fuzzy.ts`）、正文（优先 `rg` 若可用，否则 Node 流式扫描）
- 尊重 `.gitignore`；上限：结果 1000 条、单文件 10MB、总耗时 10s（超时返回部分结果 + 提示）
- 结果显示上下文行 + 行号，点击跳转
- 请求可取消（`AbortSignal`）

**验收**
- [ ] 5 万文件仓库 3 秒内返回首屏
- [ ] 取消立即生效，无孤儿进程
- [ ] 路径全部经过 allowed-roots 校验

---

## 第 4 章：常见陷阱清单（踩过的坑）

| 现象 | 原因 | 正确做法 |
|---|---|---|
| 热重载后会话丢失 | 用了模块级 Map | `globalThis.__piSessions` |
| 连续 fork 产生错乱的父子链 | fork 后 wrapper 未销毁 | `send("fork")` 后立即 `this.destroy()` |
| toolCall 显示为空 | 字段名不一致 | 走 `lib/normalize.ts` |
| 刷新页面后流式输出断了 | 未重连 SSE | mount 时 `GET /api/agent/[id]`，`isStreaming` 为真则重连 |
| 旧 run 的 SSE 复活了过期气泡 | 未用 run id 隔离 | 每次 prompt 用单调递增 run id，忽略旧 run 事件 |
| 后台标签页错过终止事件 | 只依赖 SSE | 运行中周期性 `GET /api/agent/[id]`，并在 `visibilitychange`/`online` 时对账 |
| Compact 状态不同步 | 只监听新版事件 | 同时接受 `compaction_*` 与 `auto_compaction_*` |
| 双认证 Provider 显示两次 | 按 id 判断 | 用 `lib/provider-listing.ts` 能力驱动；auth 变更后**两个列表都刷新** |
| 删了 worktree 后出现幽灵项目 | cwd 指向已删除路径 | `lib/worktree.ts` 已有回落逻辑，别绕过 |
| `npm run dev` 突然 404/崩 | 开发期跑了 `next build` | 删 `.next/` 重来，且开发期不要 build |
| 移除脏 worktree 报错 | 返回 409 `{dirty:true}` | UI 询问后带 `force` 重试 |
| 导出 HTML 栈溢出 | 深层线性会话递归 | 已在 export 路由中改成迭代版，别改回去 |

---

## 第 5 章：任务包依赖图

```
T-01 T-02 T-03 T-04 T-05 T-06     （阶段 0，互相独立，可并行）
                │
                ▼
             T-07 ──┬──► T-08 （TaskHeader 依赖状态模型）
                    └──► T-19 （审批依赖状态模型）
             T-09 ──────► T-10 （Pin/Archive 依赖拆分后的 TaskRow）
             T-11 ──┬──► T-15 （Review 依赖 DiffView）
                    └──► T-12 （工具摘要中的 diff 复用）
             T-13   （独立）
                │
                ▼
             T-14 ──► T-15 ──► T-16 ──► T-17
             T-18   （依赖 T-14 的面板状态，其余独立）
                │
                ▼
             T-19 ──► T-20 （Terminal 需要审批网关兜底）
             T-21   （独立）
             T-22   （独立）
```

**建议排期**：阶段 0 一周 → 阶段 1 三～四周 → 阶段 2 三～四周 → 阶段 3 三～四周。

---

## 第 6 章：每个任务包的交付模板

完成一个任务包时，按此格式汇报：

```markdown
## T-XX 完成报告

### 改动
- 新增：<文件列表>
- 修改：<文件:行数区间>
- 删除：<文件列表>

### 验收对照
- [x] 验收项 1 —— 如何验证的
- [x] 验收项 2 —— 如何验证的
- [ ] 验收项 3 —— **未完成，原因：……**

### 检查结果
npm run typecheck  ✅
npm run lint       ✅
npm test           ✅ (N passed)
浏览器控制台        零新增错误

### 已知遗留
<明确列出，不要藏>

### 对后续任务包的影响
<接口变化 / 新增约定>
```

**报告纪律**：没做完的就写没做完，测试没过就贴输出。**不允许用"应该可以了"代替实际验证。**
