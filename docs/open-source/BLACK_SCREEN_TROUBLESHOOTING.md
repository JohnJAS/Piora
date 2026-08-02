# 打包后 EXE 黑屏：诊断与修复记录

> 记录时间：2026-08-02（Asia/Shanghai）
>
> 现象：`npm run dist:win` 打包出的 portable EXE 启动后窗口只有深色背景（接近黑色），
> 没有任何界面内容；桌面日志里服务端一切正常。

## 1. 现象与判定

打开 EXE 后屏幕为黑色（实际是窗口背景色 `#111318`），且：

- 桌面日志（`%APPDATA%\piGUI\logs\pi-gui.log`）显示 **standalone 服务正常**：
  `Starting web server` → `Next.js 16.2.12` → `✓ Ready` → `Web server is ready`；
- 没有 `did-fail-load`、没有 `render-process-gone`（HTML 本身加载成功了）；
- 但没有渲染出任何 UI。

**结论**：页面 HTML 由 `server.js` 正常返回，但页面引用的前端静态资源
（`/static/chunks/*.js`、`/static/css/*.css`、`/public/*`）全部 404 → React 未挂载 →
只剩窗口深色背景。这是"HTML 在、JS/CSS 不在"的典型黑屏。

## 2. 根因

`next build` 的 standalone 输出（`.next/standalone/`）**默认不包含** `.next/static/` 和
`public/`。仓库的 `scripts/stage-standalone.mjs` 负责把它们拷进 standalone，但前提是
**当前 `.next` 是一次完整、干净的生产构建**。

本次失败链：

1. 开发目录的 `.next` 被开发模式污染（`npm run dev` 与 `next build` 共用同一个 `.next`，
   或构建被中断）——证据：`.next/BUILD_ID`、`.next/routes-manifest.json`、
   `.next/static/chunks/webpack.js` 全部缺失；
2. `stage-standalone.mjs` 在旧/残缺的 standalone 上继续执行（或把空的 `.next/static`
   拷了过去）；
3. `electron-builder` 只打包 `../.next/standalone`（`desktop/electron-builder.yml` 的
   `extraResources`），于是 EXE 内的 `resources/web/` 缺 `.next/static` 与 `public`；
4. EXE 启动 → 服务健康检查通过（`/api/health` 不依赖静态资源）→ 窗口加载 HTML 成功 →
   JS/CSS 404 → 黑屏。

排查时按以下顺序核对仓库状态：

```
Test-Path F:\piGUI\.next\BUILD_ID                              # 应为 True（生产构建标志）
Test-Path F:\piGUI\.next\routes-manifest.json                 # 应为 True
Test-Path F:\piGUI\.next\static\chunks\webpack.js             # 应为 True
Test-Path F:\piGUI\.next\standalone\.next\static\chunks\webpack.js   # 应为 True（打包内容）
Test-Path F:\piGUI\.next\standalone\public                    # 应为 True
```

其中任意一项为 False，就是这次黑屏的直接原因。

## 3. 修复步骤（PowerShell）

```powershell
# 1. 关闭所有 npm run dev / next dev 终端

# 2. 彻底删除被污染的 .next（含旧的 standalone）
Remove-Item -Recurse -Force F:\piGUI\.next

# 3. 重新完整打包（build:web → stage-standalone → desktop）
cd F:\piGUI
npm run dist:win

# 4. 打包前先验证 standalone 已补全
Test-Path F:\piGUI\.next\standalone\.next\static\chunks\webpack.js   # True
Test-Path F:\piGUI\.next\standalone\public                          # True
Test-Path F:\piGUI\.next\BUILD_ID                                   # True
```

正式发布按 README 要求应在**隔离工作树**中打包（`git worktree` 或干净副本），
不要在平时运行 `npm run dev` 的活动目录里执行生产构建。

## 4. 代码防护（已合入）

防止"残缺 `.next` 产出黑屏 EXE"再次发生：

- `scripts/stage-standalone.mjs`
  - 开始 staging 前校验 `.next/BUILD_ID` 必须存在（生产构建标志）；
  - 校验 `.next/static` 存在且非空；
  - 每类资源拷贝完成后再次校验目标目录非空，空目录直接 `throw` 终止打包。
  - 效果：在 dev 污染或构建中断的目录上执行 `build:web` 会立即报错并提示
    “Stop npm run dev, delete .next, then run next build again”，而不是默默产出黑屏包。

## 5. 相关界面抖动修复（同批合入）

排查黑屏时顺带修复两个 UI 抖动问题（点击顶栏“分支后三个点”菜单、hover 最右侧
会话记录/会话统计时，页面底部向上跳动）：

- `components/AppShell.tsx`
  - 顶栏菜单自动聚焦与关闭后的焦点还原改为 `focus({ preventScroll: true })`，
    禁止 focus 触发任何滚动容器滚动（菜单打开瞬间页面跳动的经典根因）；
  - 外观弹窗初始焦点同样加 `preventScroll`。
- `app/globals.css`
  - `body` 增加 `overflow: hidden`：杜绝任何瞬时溢出（菜单、tooltip、focus 滚动）
    让文档出现/消失滚动条导致整页重排抖动；
  - `.app-top-panel-frame` 增加 `scrollbar-gutter: stable`（菜单内部滚动条出现时
    内容不横跳）与 `overscroll-behavior: contain`（滚轮不链式滚动到页面）；
  - `.session-stats-tooltip` 增加 `will-change: transform, opacity`，把 tooltip
    弹入/弹出动画提升到独立合成层，避免在带 `backdrop-filter` 的输入区上逐帧
    重绘造成视觉闪烁。

验证方式：`npm run dev` 后点击顶栏“⋯”菜单、hover 顶栏右侧历史/会话统计按钮与
输入区右下角统计按钮，页面底部不应再发生任何跳动；再按第 3 节完成重打包验证 EXE。
