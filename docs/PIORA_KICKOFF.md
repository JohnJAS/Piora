# 如何让 GPT 开始改 Piora

> 给项目所有者看的操作手册。照着做即可，不需要每次重新解释背景。

---

## 1. 开工前（只做一次）

```bash
git checkout -b feat/codex-alignment
```

确认三件事：
- `npm run dev` 能起来（端口 30141）
- `npm test` 全绿
- 四份文档都在 `docs/` 下：`PIORA_DESIGN_SPEC.md` / `PIORA_GPT_DEV_GUIDE.md` / `PIORA_UI_STYLE_SPEC.md` / 本文件

---

## 2. 核心原则：**一次只给一个任务包**

不要说"照着文档把 Codex 对齐做了"。那会得到一个横跨 20 个文件、无法 review、无法回滚的巨型 diff。

正确节奏：**一个任务包 → 跑三件套 → 你验收 → 提交 → 下一个。**

任务包清单在 `docs/PIORA_GPT_DEV_GUIDE.md` 第 3 章（T-01 … T-22），执行顺序见第 5 章依赖图。

---

## 3. 每次开工的启动指令（复制粘贴）

把下面这段发给 GPT，只改最后一行的任务号：

```
你在 F:\piGUI 工作，这是 Piora —— pi Agent 的桌面 GUI（Next.js + Electron）。

开工前按顺序读这四份文件，不要跳过：
1. AGENTS.md —— 架构与已知陷阱
2. docs/PIORA_DESIGN_SPEC.md 的 §1.6 能力归属矩阵
3. docs/PIORA_UI_STYLE_SPEC.md —— 视觉规范
4. docs/PIORA_GPT_DEV_GUIDE.md —— 找到本次任务包

三条硬约束：
- 本项目是 pi Agent 的 GUI，不是 pi 的分支。禁止修改 node_modules/@earendil-works/*。
  凡是 pi 原生已有的能力（工具分类、diff 计算、审批拦截、命令注册、会话终态判断），
  必须接线复用，禁止自己实现一遍。判断依据在 §1.6。
- 开发期禁止运行 next build / npm run build，会污染 .next/ 导致 dev server 崩溃。
- 任何样式必须符合 docs/PIORA_UI_STYLE_SPEC.md：中性灰、扁平、6 级字阶、
  3 种圆角、仅浮层有阴影、悬停零位移。禁止字面色值和字面 px 字号。

本次只做一个任务包，做完就停，不要顺手做别的：

任务包：T-01
```

---

## 4. 收工时的验收指令（复制粘贴）

```
现在按 docs/PIORA_GPT_DEV_GUIDE.md 第 6 章的模板汇报：

1. 依次运行并贴出真实输出（不要描述，要输出）：
   npm run typecheck
   npm run lint
   npm test
2. 逐条对照该任务包的验收清单，说明每一条是怎么验证的。
   没做到的写没做到，不要写"应该可以"。
3. 列出已知遗留和对后续任务包的影响。

如果有任何一项没通过，先修，修完再汇报。
```

---

## 5. 推荐的执行顺序

### 第一批：地基（互相独立，风险最低，先建立信任）

| 顺序 | 任务包 | 说明 |
|---|---|---|
| 1 | **T-02** | 视觉体系对齐 —— **建议第一个做**，S1–S10 分十次提交，做完整个应用观感就变了 |
| 2 | T-01 | 移除危险删除 + Undo |
| 3 | T-03 | html lang 跟随 i18n |
| 4 | T-04 | 统一 focus trap |
| 5 | T-05 | 文件树语义化 |
| 6 | T-06 | 布局最小宽度兜底 |

> 为什么 T-02 排第一：它是纯样式，改坏了肉眼立刻能看出来，适合先摸清 GPT 在这个仓库里的表现。而且视觉一变，后面每个功能包都会在正确的底子上做。
> 注意 T-02 内部还有 S1–S10 十步，**每步单独一次对话**，不要让它一口气做完。

### 第二批：骨架

`T-07`（任务状态）→ `T-08`（任务头）→ `T-09`（拆侧栏）→ `T-10`（Pin/Archive）
并行可做：`T-11`（DiffView）→ `T-12`（工具人话化）、`T-13`（空态）

### 第三批：闭环

`T-14`（右栏）→ `T-15`（Review 只读）→ `T-16`（git 写 API）→ `T-17`（Review 可操作）→ `T-18`（命令面板）

### 第四批：能力

`T-19`（审批扩展）→ `T-20`（命令面板）、`T-21`（Electron）、`T-22`（搜索）

---

## 6. 你需要盯的四件事

GPT 在这个仓库最容易出问题的地方：

| 症状 | 你该说的话 |
|---|---|
| 自己写了 diff 算法 / 工具分类器 / 审批网关 | "这个 pi 已经有了，去读 §1.6，用 SDK 的符号重写" |
| 组件里出现 `font-size: 13px` 或 `#f5f5f5` | "违反 UI_STYLE_SPEC §9 自检清单，全部改成 token" |
| 一个 PR 改了 15 个文件 | "拆开，一次一个任务包，重构和功能不能混在一起提交" |
| 汇报"测试应该能过" | "跑一遍，把真实输出贴给我" |
| 顺手加了个主题 / 桌宠动作 | "冻结期，见设计规格第 5 章冻结清单，撤掉" |

---

## 7. 阶段收尾（每批做完一次）

```bash
# 先停掉 dev server（Ctrl+C），再执行
npm run build:app
npm run verify:package
npm run verify:release
npm run verify:hygiene
npm run smoke:portable
npm run licenses:check
```

然后用真实便携 EXE 手动过一遍：悬停零抖动、滚动、右键菜单、设置页、任务状态、审阅流程。中英文各截一轮关键界面。

---

## 8. 如果 GPT 卡住了

- **它说某个 SDK 符号不存在** → 让它去 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` 和 `core/tools/edit-diff.d.ts` 实际 grep，不要凭记忆
- **它想改 pi 的源码** → 拒绝。需要 pi 改动就提 issue 给上游，本地不打补丁
- **它反复改不对一个样式** → 让它先贴出当前 CSS 变量的实际值，再对照 UI_STYLE_SPEC 找差异
- **改动太大不敢合** → 让它先只做 S1 或只改一个文件，验证节奏对了再放开
