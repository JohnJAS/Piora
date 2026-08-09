# Piora 阶段 0 验收记录（2026-08-08）

## 结论

阶段 0「地基清理」已完成并通过验收。项目可从官方 npm registry 干净安装，开发服务器可启动，质量门槛全绿，1440 / 1280 / 960 三档界面无横向滚动或框架错误遮罩。

本轮未运行 `next build`，遵守项目开发约束。

## 任务矩阵

| 任务 | 状态 | 验收证据 |
|---|---|---|
| T-01 删除确认与 5 秒 Undo | 通过 | 已有 trash / restore 实现及回归测试；无 Shift+Click 绕过 |
| T-02 Codex 风格视觉收敛与对比度 | 通过 | Light / Dark 文本对比度测试均 ≥ 4.5:1；全量测试通过 |
| T-03 `html lang` 跟随 i18n | 通过 | 浏览器中文实测 `document.documentElement.lang === "zh-CN"`；无 hydration 警告 |
| T-04 公共 focus trap | 通过 | 新增 `hooks/useFocusTrap.ts`，接入设置、模型、技能、插件、历史、信任、桌宠、目录选择和顶部菜单；Esc 后焦点返回触发按钮 |
| T-05 文件树语义与键盘操作 | 通过 | `tree/treeitem/group`、`aria-level/expanded/selected`、roving tabindex；支持方向键、Home/End、首字母、Enter；筛选结果同样可键盘操作 |
| T-06 布局兜底 | 通过 | 中央区共享 `640px` 最小宽度；1280–1439 右栏为绝对定位覆盖层；覆盖态左右栏互斥；拖拽 clamp 与 CSS 常量对齐 |

## 依赖与安装基线

- 项目 `.npmrc` 固定 `https://registry.npmjs.org/`。
- `package-lock.json` 中 `npmmirror` URL 数量：0。
- `npm ci --registry=https://registry.npmjs.org/` 完成后复核：
  - Next.js `16.2.12`
  - Mermaid `11.16.1`
  - DOMPurify `3.4.13`
  - Undici `8.9.0`
  - Pi SDK 保持 `0.83.0`
- Pi 0.83.0 tarball 内捆绑的旧副本通过 fail-closed postinstall 自动替换并验证：
  - `brace-expansion 5.0.9`
  - `undici 8.9.0`
- 打包阶段复用同一补丁，并在 packaged web verifier 中校验最终运行时版本。

说明：`npm audit` 仍根据 Pi 0.83.0 tarball 的 lock 元数据报告 3 项（1 moderate、2 high、0 critical）。实际安装和待打包运行时副本已验证为修复版本；当前不升级 Pi SDK，以避免越过 0.83.0 的既有运行契约。

## 自动化质量门槛

干净安装后最终结果：

```text
npm run typecheck  PASS
npm run lint       PASS
npm test           PASS
tests              436 total / 431 pass / 0 fail / 5 skipped
```

5 项跳过均为当前 Windows 账户无创建符号链接权限的既有平台分支。

## 浏览器验收

| 视口 | 模式 | 中央区实测 | 横向滚动 | 错误遮罩 / 控制台错误 |
|---|---|---:|---|---|
| 1440 × 900 | split | 1156px（右栏关闭） | 无 | 无 |
| 1280 × 800 | overlay | 1264px（右栏打开、左栏自动收起） | 无 | 无 |
| 960 × 720 | overlay | 676px（左栏打开） | 无 | 无 |

额外交互验收：

- 设置弹层打开后焦点落在弹层内；按 Esc 关闭后焦点返回「设置」按钮。
- 1280px 打开右栏后左栏宽度为 0，右栏 `position: absolute`。
- 中文界面 `lang=zh-CN`。
- 页面有真实内容、无 Next.js 错误遮罩。

## 恢复与工作区说明

- npm 中断曾把桌面工作区移动到 `node_modules.broken/@piora/desktop`；已将用户修改原样恢复到 `desktop/`。
- 恢复备份继续保留并被 Git、TypeScript、ESLint 排除：
  - `F:\Piora\node_modules.broken`
  - `F:\Piora-recovery\node_modules.broken-20260808`（一次超时搬运留下的部分副本）
- 未删除或覆盖用户已有的其他工作区修改，未创建提交。
