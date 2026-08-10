# Pi GUI 与 Codex 界面差异复盘（仍存在的差距）

> 评估日期：2026-08-01
>
> Pi GUI 基线：本仓库当前工作区快照（`f1008cf` 之后的未提交状态）
>
> Codex 基线：OpenAI Codex 桌面端当前公开产品能力与官方文档
>
> 上一轮基线：`docs/CODEX_PIORA_UX_COMPARISON_2026-07-31.md`
>
> **本报告为纯只读分析，未修改任何代码。**

---

## 0. 一句话结论

过去一天（2026-08-01）的改动几乎全部落在**皮肤层与基础质量层**，结构层没有推进。

- **修好了**：Composer 渐进披露、统一设置中心、Inter 字体、focus-visible、safe-area、44px 触控、reduced-motion、回到最新按钮、Dialog 语义。这些是真实进步，主要解决"看起来像不像 Codex"和"基础可用性"。
- **没动的**：任务状态模型、Review 交付闭环、终端、权限模型、命令面板、左栏任务化。这些是"用起来像不像 Codex"，也正是上一轮标为 P0 的部分。

上一轮报告第 11.1 条写着"不要只做视觉换皮"。当前 `app/theme-packs/codex-dream-skin.css` 的存在，加上新增的桌宠、背景图、外观设置，说明这条警告**正在被踩中**：资源投在了外观，结构差距原地未动。

---

## 1. 进度总览

| 状态 | 数量 | 说明 |
|---|---|---|
| ✅ 已关闭 | 10 项 | 集中在字体、焦点、触控、动效、Composer 收纳 |
| 🟡 部分关闭 | 4 项 | 建了机制但没收干净，或只做了半层 |
| ❌ 仍存在 | 15 项 | 全部是上一轮 P0 / P1 的结构性差距 |
| ⚠️ 新增反向偏离 | 1 项 | 个性化装饰能力扩张，Codex 无对应物 |

---

## 2. 视觉布局

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 三栏结构 | 中央任务区优先，右栏按需 | ≥960px 即三栏常驻 | 🟡 | `globals.css:2276-2300` |
| 中央主区最小宽度 | 保证阅读宽度 | 1280px 下中央仅约 **480px** | ❌ | 侧栏 260 + 右栏 clamp≈538 |
| 最小宽度兜底 | — | 仅拖拽时 clamp 420px，CSS 层无兜底 | 🟡 | `lib/panel-layout.ts:13`；`AppShell.tsx:1186` 为 `min-width:0` |
| 底部终端区 | 每聊天独立终端 | 无任何终端面板 | ❌ | `app/api/` 下无 terminal 路由 |
| 任务头区域 | 状态/环境/变更数一行 | 无独立任务头 | ❌ | 顶栏直接接聊天流 |
| 移动端适配 | 渐进披露 | 抽屉 + 全屏文件面板，已达标 | ✅ | `globals.css:2303-2344` |

**改进方向**：1280–1439px 区间让右栏改为覆盖层或与左栏互斥，给中央留出 ≥640px；为 `.workspace-main` 增加 CSS 层最小宽度兜底，不要只依赖拖拽 clamp。

---

## 3. 组件结构

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 右侧面板定位 | Review 为一等公民 | 仍是 File Viewer；Changes 挂在**左栏**折叠区 | ❌ | `SessionSidebar.tsx:312-313, 1240` |
| Review / Files / Preview 三标签 | 有 | 无，Changes 与文件树同栏共存 | ❌ | `FileExplorer.tsx:702` 仅回传数量 |
| Diff 渲染 | 单一实现 | **两套**：FileViewer 70 处 / MessageView 18 处，未抽公共组件 | ❌ | `FileViewer.tsx:328`；`MessageView.tsx` |
| Diff 可操作性 | stage / unstage / revert / 逐行评论 | 只读查看 | ❌ | `app/api/git/` 只有 `diff`、`status` |
| commit / push | 支持 | 无写操作 API | ❌ | 同上 |
| 终端组件 | 每任务 PTY | 仅 Composer 内 `!` 一次性命令 | ❌ | `MessageView.tsx:1455` |
| 统一 Dialog | — | role=dialog + aria-modal 已普及 | ✅ | `SettingsDialog.tsx:94-95` 等 8 处 |
| 设置中心 | 有 | SettingsDialog 已聚合 Models/Skills/Plugins/外观/语言 | ✅ | `SettingsDialog.tsx:56-86` |

**改进方向**：先抽 `DiffView` 公共组件统一两套渲染（纯前端重构，不依赖后端），再考虑 Review 面板与 Git 写操作 API。终端优先级放在 Review 之后。

---

## 4. 交互方式

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 会话删除安全性 | Archive + Undo | **Shift+Click 跳过确认直接永久删除** | ❌ | `SessionSidebar.tsx:1686` |
| Pin / Archive | 有 | 无 | ❌ | 全库无 archive/pin 实现 |
| 会话搜索 | 有 | 无（仅 worktree 过滤框） | ❌ | `SessionSidebar.tsx:856` |
| 命令面板 | Cmd+K | 无 | ❌ | `useKeyboardShortcuts.ts:47-72` 仅 Esc / Ctrl+Alt+N |
| Tab 键盘操作 | tablist 语义 | 仍是可点击 `div`，无方向键、无 Ctrl+W | ❌ | `TabBar.tsx:44` |
| 文件树语义 | tree/treeitem | 仍是 div | ❌ | `FileExplorer.tsx:237` |
| 焦点圈定 focus trap | 有 | **无**，全库无 focus-trap / inert | ❌ | grep 无匹配 |
| 弹层初始焦点 | 有 | 项目菜单已实现，其余靠 autoFocus 零散覆盖 | 🟡 | `AppShell.tsx:370-379` |
| focus-visible | 有 | 全局已覆盖 | ✅ | `globals.css:367-372` |
| 回到最新按钮 | 有 | 已实现 | ✅ | `globals.css:931` |
| Steer / Queue | 有 | 已有且成熟 | ✅ | 保留优势 |
| 触控尺寸 | 44px | 移动端已达 44px | ✅ | `globals.css:2401` |
| reduced-motion | 有 | 已支持 | ✅ | `globals.css:2196` |
| 底部 safe-area | 有 | 已支持 | ✅ | `globals.css:799` |

**改进方向**：最低成本、最高收益的三件事——移除 Shift+Click 免确认删除、给 TabBar 加 tablist 语义、加统一 focus trap。三者都不涉及后端。

---

## 5. 信息层级

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 任务状态模型 | Running / Needs input / Ready / Blocked | `attention = running ∪ unread`，仍是两态 | ❌ | `SessionSidebar.tsx:728-730` |
| 状态可见位置 | 侧栏任务列表 | 仅桌宠按钮上一个 6px 色点，无文字 | ❌ | `AppShell.tsx:1322-1333` |
| 工具活动语言 | 人类可读摘要 | 直接渲染原始 `toolName` | ❌ | `MessageView.tsx:769` |
| 诊断信息分层 | 收进二级 | token/cost/上下文常驻顶栏统计区 | 🟡 | `AppShell.tsx:1530-1616` |
| 新会话空态 | 项目导向 starter | 无任何 starter 建议 | ❌ | `ChatWindow.tsx` 无 starter 实现 |
| 环境标识 | Local / Worktree 徽标 | 顶栏不显示当前 worktree | ❌ | worktree 切换器藏于 `SessionSidebar.tsx:482-488` |
| 变更数展示 | 任务头显示 | 仅左栏 Changes 折叠区计数 | 🟡 | `FileExplorer.tsx:702` |

**改进方向**：`attention` 从并集改为独立枚举（`needs_input` / `waiting_approval` / `failed` / `ready_unread`）需要后端事件源配合，是本轮最大的一块工程量。但"工具摘要人话化"和"空态 starter"是纯前端，可先做。

---

## 6. 色彩与字体风格

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 字体内置 | Inter | Inter 已本地内置（OFL） | ✅ | `globals.css:4-27` |
| 默认字体 | Inter | **默认仍是系统栈**，Inter 仅为可选项 | 🟡 | `globals.css:84` vs `:118` |
| 主题数量 | 少而克制 | Light/Dark/Midnight/Forest + Dream Skin 等多套 | ⚠️ | `app/theme-packs/codex-dream-skin.css` |
| 弱文本对比度（Light） | 达标 | `--text-dim: #a49a97` on `#fffdfc` = **2.71:1** | ❌ | `globals.css:61, 54` |
| 弱文本对比度（Dark） | 达标 | `--text-dim: #6b7280` on `#1a1a1a` = **3.60:1** | ❌ | `globals.css:150, 143` |
| 强调色 | 克制单色 | `#3569d4`(L) / `#60a5fa`(D)，合理 | ✅ | `globals.css:62, 151` |

> 对比度为本次实算值，与 2026-07-31 报告数值**完全一致**，确认这两个 token 未做任何调整。WCAG 普通文本要求 4.5:1，当前 10–11px 的 dim 文本双主题均不达标。

**改进方向**：Light 的 `--text-dim` 需压到约 `#6f6663` 一线，Dark 提到 `#8b93a1` 一线，才能过 4.5:1。这是一行 CSS 的事，却是遗留最久的一项。

---

## 7. 功能入口与导航逻辑

| 对比项 | Codex | Pi GUI 当前 | 状态 | 证据 |
|---|---|---|---|---|
| 左栏定位 | Projects / Chats / Activity | 仍是资源树：项目+worktree+会话+文件+Changes+上传+设置 | ❌ | `SessionSidebar.tsx` 整体结构 |
| Activity 入口 | 一级 | 无 | ❌ | — |
| 顶栏控件数 | 克制 | **约 11 个常驻**（侧栏/项目/外观/语言/桌宠/信任/历史/自动命名/分支/SystemPrompt/溢出/统计/文件面板） | ❌ | `AppShell.tsx:1189-2209` |
| 顶栏 overflow | 有 | 已建，但**只收了 2 项**（工具预设、通知） | 🟡 | `AppShell.tsx:1499, 1762-1830` |
| 入口唯一性 | 单一 | 外观/语言在顶栏与 Settings hub **双重暴露** | ❌ | `AppShell.tsx:1254, 1278` vs `SettingsDialog.tsx:56-86` |
| Composer 常驻控件 | 4 项左右 | 5 项（附件/统计/上下文环/模型/发送），推理与 Compact 已折进模型下拉 | ✅ | `ChatInput.tsx:1614-1991, 1848-1927` |
| 权限模型 | Sandbox + Approval 分级 | **完全不存在**，只有 Project Trust + 三档工具预设 | ❌ | 全库无 permission/approval UI |
| html lang | 跟随语言 | 硬编码 `lang="en"` | ❌ | `app/layout.tsx:63` |

**改进方向**：顶栏是当前信息层级最大的问题——溢出菜单已经建好，把外观、语言、自动命名、System Prompt、分支导航这 5 项收进去即可，改动量小且不触碰逻辑。

---

## 8. 新增的反向偏离

2026-08-01 新增了一批 Codex **完全没有对应物**的能力：

| 新增模块 | 文件 | 性质 |
|---|---|---|
| 桌面宠物 | `CompanionPet.tsx` (15KB) + `CompanionSettingsDialog.tsx` | 装饰/陪伴 |
| 背景图设置 | `BackgroundSettings.tsx` (7.7KB) | 装饰 |
| 外观风格 | `AppearanceLooks.tsx` | 装饰 |
| Dream Skin 主题包 | `app/theme-packs/codex-dream-skin.css` | 视觉换皮 |

这不必然是错误——如果产品定位就是"更有人味的本地 Agent 工作台"，桌宠是有效差异化。但需要明确一点：

> **这四个模块合计新增的代码量，超过了实现"移除 Shift+Click 危险删除 + TabBar 语义化 + 修复两处对比度 token + 顶栏收纳 5 项"的总和，而后者全部是上一轮标为 P0 的问题。**

桌宠上那个 6px 状态点（`AppShell.tsx:1322-1333`，含 running/waiting/review/failed 四色）尤其说明问题：**四态状态语言已经被设计出来了，却只呈现在一个装饰性组件上，没有回流到侧栏会话列表这个真正需要它的地方。**

---

## 9. 建议的下一步（按性价比排序）

### 第一梯队：纯前端，改动小，全部是 P0 遗留

1. 移除 `SessionSidebar.tsx:1686` 的 Shift+Click 免确认删除
2. 修正 `--text-dim` 双主题对比度至 4.5:1
3. 顶栏 5 项低频控件收进已有的 overflow 面板，消除外观/语言双入口
4. `TabBar.tsx` 改 `role=tablist/tab` + 方向键 + Ctrl+W
5. 把桌宠已有的四态状态点，复用到侧栏会话行

### 第二梯队：前端重构

6. 抽取统一 `DiffView`，合并 FileViewer 与 MessageView 两套 Diff
7. 工具调用改人类可读摘要，原始 payload 进 Diagnostics
8. 新会话空态加 3–5 个项目导向 starter
9. 统一 focus trap 与关闭后焦点返回
10. `html lang` 跟随 i18n

### 第三梯队：需要后端配合

11. 多轴任务状态模型（lifecycle / runtime / attention）+ 服务端事件源
12. Git 写操作 API（stage / revert / commit）+ Review 面板
13. 每任务 PTY 终端
14. 真实 sandbox / approval 权限模型，之后才暴露 Permission UI

---

## 10. 总体判断

与 Codex 的**视觉距离**在这一天里明显缩短了——字体、焦点、动效、触控、Composer 收纳都做到位了，第一眼观感已经接近。

但**结构距离**一步没动。上一轮列出的 8 项 P0，只完成了第 4 项的一半（Composer 渐进披露）和第 6 项的一部分（键盘焦点）。其余 6 项半——任务状态、左栏任务化、顶栏瘦身、统一错误反馈、最小 Review、Process 人话化——原样保留。

一句话：**皮肤对齐了 Codex，骨架还是 Pi 的控制台。**
