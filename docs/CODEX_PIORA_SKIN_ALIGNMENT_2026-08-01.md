# Pi GUI 皮肤对齐 Codex · 专项对比（2026-08-01）

> 范围限定：**仅评视觉皮肤层**——色彩 token、字体、圆角/密度、主题与皮肤机制、装饰维度。
> 不涉及信息架构、交互方式、功能入口、状态模型（即"骨架"，不在本版范围）。
> 本报告不改任何代码，仅做差异分析。基线沿用 `CODEX_PI_GUI_UX_COMPARISON_2026-07-31.md`，皮肤结论以 8-01 当前代码实测为准。

---

## 0. 一句话结论

**皮肤层"有 Codex 皮肤，但默认不穿"。**

- ✅ 已对齐：Inter 成为默认字体、Codex-Dream 深色皮肤已忠实适配、主题切换动效（View Transitions）。
- 🟡 部分对齐：通用浅色的强调色接近 Codex，但背景偏暖；对比度 token 仅在 Dream 深色达标。
- ❌ 未对齐：默认 shipped 皮肤是 4 套 Pi 原创 Pastel + 暖米通用浅色，**均非 Codex 风**；Codex 皮肤被做成**深色 opt-in**，不在主外观入口，且**没有浅色版**。

---

## 1. 维度对比表（皮肤层）

| 维度 | Codex 皮肤特征 | Pi GUI 当前实现 | 状态 |
|---|---|---|---|
| 字体 | 中性无衬线（Inter 类） | Inter 已设为 `--ui-font-family` 首位（globals.css:118） | ✅ 已对齐 |
| 浅色强调色 | 中性冷灰白 + 蓝/青强调 | 通用浅色 accent `#3569d4`（蓝，近 Codex）；但背景暖米 `#fffdfc`、边框橄榄 `#e5dfdd` | 🟡 部分 |
| 深色主色板 | 中性近黑 + 绿/青强调 | Dream 皮肤 `#111318` + 绿 `#8da397`，忠实还原社区 Codex 皮肤 | ✅ 深色已对齐 |
| 浅色 Codex 皮肤 | 有 | Dream 皮肤**只定义深色 token**，浅色回退到暖米通用色板 | ❌ 缺失 |
| 外观入口 | 系统浅/深 2 项 | 主入口暴露 4 套 Pi 原创 Pastel；Dream(Codex) 不在网格内 | ❌ 未对齐 |
| 圆角/密度 | 偏紧（约 6–8px） | `--radius-*` = 5 / 8 / 11 / 14，整体略圆 | 🟡 轻微 |
| 主题切换动效 | 原生过渡 | View Transitions 圆形擦除（useTheme.ts + globals.css:154+） | ✅ 对齐（且更精致） |
| 辅助文字对比度 | ≥ 4.5:1 | 默认浅 `2.71:1`、通用深绿 `3.68:1` 不达标；Dream 深 `4.58:1` 达标 | 🟡 部分 |
| 装饰维度 | 无宠物/壁纸/多皮肤 | CompanionPet、壁纸系统、4 套 Pastel，Codex 无对应物 | ❌ Pi 更"花" |

对比度实测（WCAG 普通文本要求 4.5:1）：
- 默认浅色 `--text-dim` `#a49a97` / `#fffdfc` = **2.71:1** ❌
- 通用深色（绿）`#697d6e` / `#17231b` = **3.68:1** ❌
- Dream 深色 `#748087` / `#111318` = **4.58:1** ✅（Codex 皮肤反而修好了这项）

---

## 2. 三个关键发现

### 2.1 Codex 皮肤存在，但是"深色 opt-in"，且浅色缺失

`app/theme-packs/codex-dream-skin.css` 是社区 Codex-Dream-Skin 的 Pi 化适配（MIT，仅改 CSS 变量）：
- `:12-30` 只定义 `html.dark[data-theme="dream"]` 的颜色 token（背景、强调、边框等）。
- `:32-54` 的 `html[data-theme="dream"]`（浅色）**只写背景渐变与玻璃质感，不定义任何颜色 token** → 浅色下回退到通用 `:root` 暖米色板。

**结论：** Codex 皮肤只有"深色版"，且需手动切 `data-theme="dream"`，不是开箱即用的浅/深双模。

### 2.2 默认皮肤入口是 Pi 原创 Pastel，不是 Codex

`components/AppearanceLooks.tsx:21-62` 定义的 4 套皮肤：
- **starlight** 星海（紫 `#7857e8`，极光玻璃）
- **ivory** 象牙（橄榄 `#78834f`， Sage 纸纹）
- **doodle** 涂鸦（活泼涂鸦）
- **fortune** 福运（祥云）

这些是 Pi 自家的审美表达，**Codex 没有等价物**。通用 `:root` 浅色（暖米 + 橄榄边框）同样偏离 Codex 的中性冷灰。也就是说，用户从主入口点开"外观"，看到的默认选项是"更像 Pi"，而不是"更像 Codex"。

### 2.3 "对齐 Codex"反而比 Codex 更花

主皮肤比 Codex 多了：桌宠（CompanionPet）、壁纸系统（BackgroundSettings）、4 套 Pastel。若目标真的是"皮肤对齐 Codex"，默认表面应更克制、中性；但当前方向相反——在持续增加装饰维度。这与 7-31 报告第 11.1 节"不要只做视觉换皮"的提醒并不冲突，只是说明：**目前"皮肤"这一层恰恰是最偏离 Codex 的一层**。

---

## 3. 要真正"皮肤对齐 Codex"，皮肤层最小改动清单（不碰骨架）

| # | 改动 | 性质 | 优先级 |
|---|---|---|---|
| 1 | 把 Dream(Codex) 皮肤提升为 AppearanceLooks 主网格的一等选项（或默认），让用户从主入口一键切到 Codex 外观 | 皮肤机制 | 高 |
| 2 | 补一套**浅色 Codex 皮肤**（中性冷灰白、蓝/青强调、去掉暖米/橄榄），让 Codex 外观在浅色下也成立 | 新增皮肤 | 高 |
| 3 | 修默认浅色与通用深绿的 `--text-dim` 对比度到 ≥4.5:1（当前 2.71 / 3.68）；可参照 Dream 深已达标取值 `#748087` | 调 token | 高 |
| 4 | 若要保持"对齐 Codex"的纯净感，把 Pi 原创 Pastel / 桌宠 / 壁纸收为"进阶皮肤"次级入口，而非默认主表面 | 皮肤机制 | 中 |
| 5 | 圆角整体收紧一档（surface 11→8、panel 14→10）以更接近 Codex 紧凑感 | 调 token | 低（可选） |

> 仅做 1+2+3，即可让"皮肤对齐 Codex"从"有但藏起来"变成"开箱可选、浅深双模、可读达标"。

---

## 4. 与 8-01 全量报告的分工

- **全量报告**（`CODEX_PI_GUI_UI_GAP_2026-08-01.md`）覆盖视觉布局、组件结构、交互、信息层级、功能入口、骨架等六维；本版只评皮肤。
- 8-01 全量里已修、且属于皮肤相关的：
  - Inter 设为默认字体 ✅（本版确认已对齐）
  - 主题切换动效 ✅
- 8-01 全量里已修、但不属皮肤层的（本版不重复计）：`:focus-visible`、safe-area、44px 触控、reduced-motion、Dialog 语义。
- 皮肤层 8-01 **仍未动**的：默认皮肤非 Codex、Codex 浅色缺失、`--text-dim` 对比度、Pi 装饰过盛。

---

## 5. 证据索引

- 字体默认：`app/globals.css:118`（`--ui-font-family: 'Inter', …`）
- 通用浅色暖米色板：`app/globals.css:48-61`（`:root`）
- 通用深色（绿）色板：`app/globals.css:141-153`（不包括对比度达标项）
- Codex-Dream 皮肤（仅深色 token）：`app/theme-packs/codex-dream-skin.css:12-30`
- Codex-Dream 浅色仅渐变无 token：`app/theme-packs/codex-dream-skin.css:32-54`
- 主外观入口的 Pi 原创 Pastel：`components/AppearanceLooks.tsx:21-62`
- 主题切换动效：`app/globals.css:154+` + `hooks/useTheme.ts`
