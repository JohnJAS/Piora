# Piora 视觉规范（Codex 风格：简洁 · 克制 · 优雅）

> 版本：v1.0 ｜ 基线：`b8d7e69` ｜ 编写日期：2026-08-07
> 配套：`docs/PIORA_DESIGN_SPEC.md`（功能）· `docs/PIORA_GPT_DEV_GUIDE.md`（任务包）
> **本文件是唯一视觉真理来源。任何组件样式与本文件冲突，改组件。**

---

## 0. 风格判据

Codex 的视觉气质可以拆成四条可执行的规则。**每写一个样式，用它们自检：**

| 规则 | 含义 | 违反的样子 |
|---|---|---|
| **中性** | 灰阶不带色偏，颜色只用在真正需要区分的地方 | 暖米色背景、彩色主题包 |
| **扁平** | 用发丝边框和背景差分层，不用阴影堆叠 | 每个卡片都有 shadow + inset 高光 |
| **克制** | 一屏内颜色 ≤3 种、字号 ≤4 级、圆角 ≤2 种 | 18 级字阶、7 套主题、4 种圆角 |
| **留白** | 密度靠间距控制，不靠缩小字号 | 10px 文字挤在一起 |

> 一句话检验：**把界面截图转成灰度，信息层级应该依然清晰。** 如果不清晰，说明在用颜色代替层级。

---

## 1. 现状诊断

| 项 | 现状 | 判定 |
|---|---|---|
| 调色板色相 | `--bg:#fffdfc` `--bg-panel:#f7f4f3` `--border:#e5dfdd` — 暖红棕偏色 | ❌ 与 Codex 中性灰冲突，**最大的一处偏离** |
| 字阶 | 18 级（`--font-3xs` … `--font-display`） | ❌ 收敛到 6 级 |
| 圆角 | 4 种（5/8/11/14px） | 🟡 收敛到 3 种 |
| 阴影 | 3 种，含 inset 高光 | ❌ 收敛到 1 种（仅浮层） |
| 半透明 | `--chrome-translucent` `--panel-translucent` | ❌ 移除，改实色 |
| 主题数 | 7+（light/dark/starlight/ivory/doodle/fortune/midnight/forest） | ❌ 主线只留 2 |
| 皮肤包 | `globals.css:2` 全局 `@import codex-dream-skin.css` | ❌ 不应无条件全局导入 |
| 默认字体 | 系统栈，Inter 仅可选 | ❌ 默认改 Inter |
| `--text-dim` 对比度 | Light 2.71:1 / Dark 3.60:1 | ❌ 不达标 |

---

## 2. 色彩

### 2.1 中性灰阶（**替换现有暖色调**）

**Light**
```css
:root {
  color-scheme: light;
  --bg:            #ffffff;   /* 画布 */
  --bg-panel:      #f7f7f8;   /* 侧栏、面板 */
  --bg-hover:      #f0f0f1;
  --bg-selected:   #e8e8ea;
  --bg-subtle:     rgba(24, 24, 27, 0.035);

  --border:        #e4e4e7;   /* 发丝线，默认 */
  --border-strong: #d4d4d8;   /* 需要强调分隔时 */

  --text:          #18181b;   /* 正文 */
  --text-muted:    #52525b;   /* 次要（7.7:1） */
  --text-dim:      #71717a;   /* 元信息（4.8:1 ✓） */
}
```

**Dark**
```css
html.dark {
  color-scheme: dark;
  --bg:            #111113;
  --bg-panel:      #18181b;
  --bg-hover:      #1f1f23;
  --bg-selected:   #27272a;
  --bg-subtle:     rgba(255, 255, 255, 0.04);

  --border:        #27272a;
  --border-strong: #3f3f46;

  --text:          #f4f4f5;
  --text-muted:    #a1a1aa;   /* 7.4:1 */
  --text-dim:      #8b8b94;   /* 5.6:1 ✓ */
}
```

> 上述对比度为本文档实算值，但**必须由 `lib/contrast.test.mjs`（任务 T-02）自动验证**，不要凭肉眼。

### 2.2 强调色（**只有一个，且低饱和**）

```css
/* Light */
--accent:        #2f6feb;
--accent-hover:  #2560d4;
--accent-subtle: rgba(47, 111, 235, 0.08);   /* 选中背景、focus 环底色 */

/* Dark */
--accent:        #6a9bff;
--accent-hover:  #85adff;
--accent-subtle: rgba(106, 155, 255, 0.12);
```

**强调色只用于三处**：焦点环、当前选中项标识、主按钮。**不用于**：图标常态、边框、正文强调、装饰。

### 2.3 主按钮（Codex 的黑底按钮）

```css
/* Light：近黑底 + 白字，比蓝色更克制 */
--btn-primary-bg:       #18181b;
--btn-primary-fg:       #ffffff;
--btn-primary-bg-hover: #27272a;

/* Dark：反过来 */
--btn-primary-bg:       #f4f4f5;
--btn-primary-fg:       #18181b;
--btn-primary-bg-hover: #e4e4e7;
```

### 2.4 状态色（与 `lib/task-status.ts` 的四态一一对应）

```css
--status-running:   #2f6feb;   /* 蓝 · 运行中 */
--status-attention: #d97706;   /* 琥珀 · 等待确认/输入 */
--status-failed:    #dc2626;   /* 红 · 失败 */
--status-ready:     #16a34a;   /* 绿 · 有新结果 */
```
Dark 模式各提亮一档：`#6a9bff` / `#f0a53a` / `#f0605d` / `#4ade80`。

**状态色只用于状态点和状态词，禁止用作背景块。**

### 2.5 语义背景

```css
--user-bg:       var(--bg-panel);      /* 用户消息：不再用蓝色块 */
--assistant-bg:  transparent;          /* 助手消息：无背景，靠留白区分 */
--tool-bg:       var(--bg-panel);      /* 工具调用：面板底 */
```

> **重要**：Codex 的聊天流里，助手消息**没有气泡**。取消 `--assistant-bg` 的实色，用留白和字重区分角色。这一条改动对"像不像 Codex"的影响，超过其他所有色值加起来。

### 2.6 主题策略

| 主题 | 处置 |
|---|---|
| Light / Dark | **主线，只维护这两套** |
| starlight / ivory / doodle / fortune / midnight / forest | 移入设置中心「更多主题」折叠区，**不参与视觉规范约束**，不做回归 |
| `codex-dream-skin.css` | **取消 `globals.css:2` 的无条件全局 `@import`**，改为按需加载 |

---

## 3. 字体与字阶

### 3.1 字族

```css
--ui-font-family:   'Inter', 'Microsoft YaHei UI', 'PingFang SC', sans-serif;  /* 默认改 Inter */
--font-code-family: 'JetBrains Mono', 'Consolas', var(--font-noto-mono), monospace;
```
Inter 已本地内置（OFL，`/fonts/inter`）。**把 Inter 从"可选"改为"默认"** —— 中文回退到雅黑/苹方。

### 3.2 字阶（18 级 → **6 级**）

```css
--ui-font-size: 14px;          /* 根，用户可调 */

--text-xs:   0.821rem;  /* ≈11.5px  元信息、时间戳、徽标 */
--text-sm:   0.893rem;  /* ≈12.5px  次要标签、按钮、列表副行 */
--text-base: 1rem;      /* =14px    UI 默认、列表主行 */
--text-md:   1.071rem;  /* ≈15px    聊天正文 */
--text-lg:   1.214rem;  /* ≈17px    区块标题 */
--text-xl:   1.429rem;  /* =20px    页面标题、空态主标题 */
```

**规则**
- 全部用 rem，跟随 `--ui-font-size`，保留现有文字大小偏好功能；
- **禁止**在组件里写 `font-size: 13px` 这类字面值；
- 旧的 `--font-3xs` … `--font-display` 保留为别名映射到新 6 级，逐步迁移后删除。

### 3.3 字重与行高

| 用途 | 字重 | 行高 |
|---|---|---|
| 正文 / 列表主行 | 400 | 1.55 |
| 次要 / 元信息 | 400 | 1.4 |
| 标题 / 选中项 / 按钮 | 500 | 1.35 |
| 强调（罕用） | 600 | 1.3 |

**禁止 700**。Codex 的层级靠字号和颜色，不靠粗体。

---

## 4. 形状 · 阴影 · 边框

### 4.1 圆角（4 种 → 3 种）

```css
--radius-control: 6px;    /* 按钮、输入框、徽标、小卡片 */
--radius-surface: 10px;   /* 面板、对话框、Composer */
--radius-panel:   14px;   /* 大浮层、模态 */
```
`--radius-small: 5px` 废弃，映射到 `--radius-control`。

### 4.2 阴影（3 种 → 1 种）

```css
--shadow-popover: 0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06);
```
**只有脱离文档流的浮层（下拉、命令面板、模态、右键菜单）能用阴影。**
`--shadow-surface`、`--shadow-control` 及所有 `inset` 高光 **全部删除** —— 面板靠 `--border` + `--bg-panel` 分层。

### 4.3 边框

- 默认 `1px solid var(--border)`，永远 1px，不用 2px；
- 分隔线用 `border-top`，不用 `<hr>`，不用渐变；
- **不用半透明边框**（现有 `--border-soft` 废弃）。

### 4.4 半透明

`--chrome-translucent` / `--panel-translucent` **删除**，顶栏和面板改实色。毛玻璃在 Windows 上渲染成本高且与"扁平"冲突。

---

## 5. 间距与密度

### 5.1 间距阶（4px 基数）

```css
--space-1: 4px;    --space-2: 8px;    --space-3: 12px;
--space-4: 16px;   --space-5: 20px;   --space-6: 24px;
--space-8: 32px;   --space-10: 40px;
```
**只用这 8 个值**，禁止 `padding: 7px 13px` 这类。

### 5.2 关键尺寸（固定值，全局一致）

| 元素 | 高度 |
|---|---|
| 顶栏 | 40px |
| 任务头 | 48px |
| 侧栏列表行 | 28px |
| 文件树行 | 24px |
| 标准按钮 / 输入框 | 32px |
| 小按钮 / 图标按钮 | 28px |
| 移动端可点击区 | ≥44px（保持现有） |

### 5.3 内容宽度

- 聊天流正文最大宽度 **760px**，居中；超宽屏不拉满 —— 这是阅读舒适度的关键。
- 中央区最小宽度 **640px**（见设计规格 §2.2）。

### 5.4 布局稳定（硬性）

**悬停前后，元素的位置和尺寸必须完全不变。**
```css
/* ✅ 正确 */
.row-actions { visibility: hidden; }
.row:hover .row-actions { visibility: visible; }

/* ❌ 禁止 —— 会导致行抖动 */
.row-actions { display: none; }
.row:hover .row-actions { display: flex; }
```
悬停操作区必须是**固定宽度**容器。

---

## 6. 组件样式基线

### 6.1 按钮

| 类型 | 样式 |
|---|---|
| Primary | `--btn-primary-bg` 底 + `--btn-primary-fg` 字，`--radius-control`，无边框，无阴影 |
| Secondary | 透明底 + `1px solid var(--border)` + `--text` |
| Ghost | 透明底无边框，hover 时 `--bg-hover` |
| Danger | 透明底 + `--status-failed` 字；hover 才出红底 |

统一 `height: 32px; padding: 0 12px; font-size: var(--text-sm); font-weight: 500;`
过渡：`transition: background-color 120ms ease-out, color 120ms ease-out;`

### 6.2 输入框 / Composer

```css
background: var(--bg);
border: 1px solid var(--border);
border-radius: var(--radius-surface);
/* 聚焦：不加粗边框，换颜色 + 外发光 */
:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}
```
Composer 常驻控件 ≤5 个（现状已达标，**不要再加**）。

### 6.3 列表行（侧栏任务 / 文件树）

```
[状态点 6px] [图标 14px] [主文本 --text-base] ……… [元信息 --text-xs] [操作区 固定宽]
```
- 常态：透明底
- hover：`--bg-hover`
- 选中：`--bg-selected` + 左侧 2px `--accent` 竖条（**不用整行变蓝**）
- 单行不换行，溢出 `text-overflow: ellipsis`

### 6.4 聊天消息

| 角色 | 样式 |
|---|---|
| 用户 | `--bg-panel` 底，`--radius-surface`，右对齐留白，最大 80% 宽 |
| 助手 | **无背景无边框**，纯文本流，`--text-md` |
| 工具调用 | 折叠态固定 28px 高，`--bg-panel` 底，`--radius-control`，左侧状态图标 |
| Diff | `--font-code-family`，增行 `rgba(22,163,74,.10)`，删行 `rgba(220,38,38,.10)` |

### 6.5 焦点环（全局统一）

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: inherit;
}
```
**禁止**任何地方 `outline: none` 而不提供替代焦点指示。

### 6.6 图标

- 统一 `AliIcon`，尺寸只用 **12 / 14 / 16 / 20**；
- 常态色 `--text-muted`，hover `--text`，**不用强调色**；
- 图标按钮必须有 `aria-label`。

---

## 7. 动效

| 场景 | 时长 | 缓动 |
|---|---|---|
| 颜色 / 背景 / 透明度 | 120ms | `ease-out` |
| 面板展开收起 | 160ms | `cubic-bezier(0.2, 0, 0, 1)` |
| 浮层出现 | 140ms | `ease-out`，仅 opacity + 4px 位移 |

**禁止**：缩放弹跳、旋转、>200ms 的过渡、`transition: all`。
`prefers-reduced-motion: reduce` 时全部降为 0（现有已支持，保持）。

---

## 8. 迁移路径（给实施 Agent）

**这是 T-02 的扩展版，按此顺序，一步一提交：**

| 步 | 动作 | 验证 |
|---|---|---|
| S1 | 替换 Light/Dark 中性灰阶 + 强调色 + 状态色（§2） | `contrast.test.mjs` 全绿；截图对比 |
| S2 | 写 `lib/contrast.test.mjs`，锁死对比度 | 改坏色值时测试必须失败 |
| S3 | 新增 6 级字阶，旧 18 级设为别名 | 视觉无变化（纯别名） |
| S4 | 删除 `--shadow-surface` / `--shadow-control` / inset 高光 / 半透明 token | 面板仍有清晰分层 |
| S5 | 圆角 4→3，`--radius-small` 设别名 | 无视觉突变 |
| S6 | 默认字体改 Inter | 中文正确回退 |
| S7 | **取消助手消息气泡背景**，改留白分隔 | 这一步视觉变化最大，单独提交 |
| S8 | 取消 `globals.css:2` 的全局 `@import dream-skin` | 主题切换仍可用 |
| S9 | 6 套装饰主题移入「更多主题」折叠区 | 已选用户不受影响 |
| S10 | 逐组件迁移到新字阶 / 间距阶，删除旧别名 | 全库无字面 px 字号 |

**每步都要**：`npm run typecheck && npm run lint && npm test`，浏览器实测双主题，控制台零新增错误。

---

## 9. 自检清单（每个 PR 过一遍）

- [ ] 没有字面色值，全部走 CSS 变量
- [ ] 没有字面 `font-size: Npx`，全部走 6 级字阶
- [ ] 没有非 4 倍数的 padding/margin
- [ ] 圆角只用 3 个 token 之一
- [ ] 非浮层元素没有 `box-shadow`
- [ ] hover 前后布局零位移
- [ ] 一屏内颜色 ≤3 种（不含状态点）
- [ ] `:focus-visible` 可见
- [ ] 双主题都测了
- [ ] 灰度截图后层级依然清晰
