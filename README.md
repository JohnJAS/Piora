# Piora

<p align="center">
  <img src="desktop/build/icon.png" alt="Piora original application icon" width="112" height="112">
</p>

[![CI](https://github.com/kexijiang/pi-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/kexijiang/pi-gui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Desktop-Windows%20x64-2563eb.svg)](desktop/README.md)

Piora 是一个面向 [Pi](https://github.com/earendil-works/pi) 的开源桌面应用。它基于
[pi-web](https://github.com/agegr/pi-web) 演进，目标不是重新发明 Agent，而是在保留 Pi
运行时、会话、工具、skills 与 extensions 的前提下，提供接近现代代码桌面应用的文件和视觉体验。

> Piora 由社区独立维护，不隶属于或代表 Pi、pi-web、OpenAI 或 Codex。

> 当前按首个公开预发布版本建设。是否存在可下载的 Windows 产物，以
> [GitHub Releases](https://github.com/kexijiang/pi-gui/releases) 为准；本地构建配置不等于已发布、已签名或已完成干净机器验证的二进制。

## 这次版本解决什么

- 左侧继续保留会话/项目导航与下方文件树。
- 主聊天消息、Markdown、工具调用和 Process 展示格式保持不变。
- 右侧文件工作区可以直接编辑文本、代码和 Markdown，不再只是预览。
- 保存采用内容版本校验；外部修改不会静默覆盖本地草稿。
- 内置 20 张原创背景，并支持选择本机图片、遮罩、模糊和一键恢复。
- 可选桌宠面板展示 Pi 运行状态、待办事项和可配置快捷短语，并可显式导入本机 Codex 宠物素材。
- Pi 的扩展仍由 Pi 原生资源加载器发现和执行；Piora 不增加自己的 SubAgent 产品层。

![20 个内置原创背景总览](docs/assets/backgrounds-overview.webp)

## 主要能力

### 文件工作区

- Source / Edit / Preview / Diff 四种文本视图。
- 行号、行列状态、Tab/Shift+Tab 缩进、`Ctrl+S` / `Cmd+S`。
- 文件标签 dirty 标记，跨标签切换保留草稿。
- 关闭脏标签、切换项目和关闭页面前的数据保护。
- 磁盘文件变化时，干净状态自动刷新；有草稿时显示冲突而不覆盖。
- 冲突提供继续编辑、重新载入磁盘版本和明确覆盖三种选择。
- 图片、音频、PDF 和 DOCX 保持只读预览。

文件写入只允许发生在已授权项目根目录中的普通 UTF-8 文本文件。后端使用 SHA-256
内容版本、HTTP 409 冲突、大小限制、路径/符号链接校验、文件锁和原子替换；会话中引用的
项目外文件不会因为可预览而获得写权限。

### 主题与背景

- 配色主题：Light、Dark、Midnight、Forest、Dream Skin。
- 20 张本地 WebP 背景，风格覆盖极光玻璃、宣纸植物、趣味涂鸦、祥云、星云、赛博、
  水彩、山水、侘寂、北欧冰晶、合成波、深海、森林、沙漠、樱花、装饰艺术、包豪斯、
  亚麻、雨夜散景和星象羊皮纸。
- 用户可以选择 PNG/JPEG/WebP/AVIF 本地图片；图片优先存入 IndexedDB，不上传。
- 支持可读性遮罩、模糊和恢复默认。
- 主题与背景均不能运行 JavaScript、HTML、远程 CSS 或 CDP 注入。

生成记录、哈希与许可说明位于
[`public/themes/dream-backgrounds`](public/themes/dream-backgrounds/README.md)。运行
`npm run verify:backgrounds` 可验证 20 个资源与 manifest 一致、可解码、尺寸合格且内容不重复。

### 可选桌宠

- 新配置默认关闭，可随时打开或关闭，不是第二个 Agent，也不会增加 SubAgent 能力。
- 状态来自现有 Pi 会话；TODO、快捷短语、面板状态和所选宠物只保存在本地应用配置中。
- 快捷短语只有在用户明确点击发送后，才会经过与输入框相同的普通 Pi 消息路径。
- 只有打开或手动刷新桌宠面板时，才会扫描本机 Codex 宠物目录；导入会把通过校验的
  声明式 manifest 与 PNG/WebP spritesheet 复制到 `~/.pi/agent/pi-gui/pets`。
- 不执行宠物包内的 JavaScript、HTML、CSS、npm scripts、CDP hook 或远程资源。

该能力是独立维护的文件格式兼容层，不是 OpenAI/Codex 官方集成；项目不捆绑 Codex
宠物图像或品牌素材。详细的数据目录和删除方法见
[隐私与网络行为](docs/open-source/PRIVACY_AND_NETWORK.md)。

### Pi 扩展能力

Piora 直接使用 Pi 的 AgentSession、资源加载器、SettingsManager 和 package/skill/extension
机制。Web 开发环境继续使用已经安装的 JavaScript/TypeScript extensions、skills、prompts
和 packages；桌面打包已保留同一加载路径，但每个公开 Windows 版本必须通过隔离扩展 fixture
后才能声明打包支持。项目扩展仍受 Project Trust 约束。

Portable EXE 不内置 npm、npx、Git、编译器、用户扩展、API Key 或 `~/.pi/agent`。因此：

- 已安装的常规扩展可以由 Pi 运行时加载；
- 需要外部 npm/npx/Git 的安装或更新操作依赖系统 `PATH`；
- 原生 `.node` 模块受 Electron/Node ABI 限制，暂不承诺完整兼容；
- 假设独占全屏终端的扩展 UI 不是桌面 GUI 的兼容目标。

完整边界见 [Pi 扩展兼容说明](docs/open-source/EXTENSION_COMPATIBILITY.md)。

## 环境要求

- Node.js 22.19.0 或更高版本（仓库包含 `.nvmrc`）
- npm 10 或更高版本
- Git
- Windows 上建议安装 Git for Windows，以便 Pi 工具使用 Bash
- 桌面发行目标：Windows 10/11 x64

仓库只支持提交的 `package-lock.json` 与 npm 工作流；不维护 Bun、Yarn 或 pnpm 锁文件。

## 本地开发

```powershell
git clone https://github.com/kexijiang/pi-gui.git
cd pi-gui
npm ci
npm run dev
```

开发服务器默认监听 <http://127.0.0.1:30141>。

日常开发不要在活动工作目录运行 Next.js 生产构建，以免 `.next` 与开发服务互相干扰。

## 验证

```powershell
npm run lint
npm run typecheck
npm test
npm run verify:hygiene
npm run verify:backgrounds
npm run licenses:generate
```

第三方包清单由锁文件生成到 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
该清单覆盖完整锁文件，不代表所有包都会进入最终 Windows 产物。运行依赖若没有包声明或
版本限定的人工复核许可会使生成流程失败；`format@0.2.2` 与 `khroma@2.1.0` 的 MIT 文本、
固定上游提交和哈希记录在 `third_party/`。未使用的 LobeHub peer UI 依赖链不进入锁文件，
正式二进制仍须通过产物级 manifest、SBOM 与许可证文本复核。详见 [NOTICE](NOTICE) 与
[公开发布检查表](docs/open-source/LAUNCH_CHECKLIST.md)。

## 构建 Windows 应用

```powershell
# 生成 Web standalone 与 Electron 主进程
npm run build:app

> 若打包出的 EXE 打开是黑屏（HTML 能加载但 JS/CSS 404），通常是在 dev 污染的
> `.next` 目录上打包所致；诊断与修复步骤见
> [BLACK_SCREEN_TROUBLESHOOTING.md](docs/open-source/BLACK_SCREEN_TROUBLESHOOTING.md)。
> `stage-standalone.mjs` 已内置 BUILD_ID/静态资源完整性校验，残缺 `.next` 会直接报错。

# 生成 unpacked 测试目录
npm run pack:win

# 在仓库外隔离验证 standalone 服务
npm run verify:package

# 生成 portable EXE
npm run dist:win
```

产物位于 `desktop/release/`。首批 Windows 产物是未签名预发布包，Windows 可能显示信誉警告；

Windows EXE、浏览器 favicon 与 PWA 使用同一套原创 Piora 标志。多尺寸 ICO、透明 PNG、
完整生成提示词和 MIT 许可记录见 [`desktop/build`](desktop/build/README.md)。
在代码签名、干净虚拟机升级/卸载和数据保留验证完成前，不应把它描述为已签名稳定发行版。

## 数据与网络

Piora 不包含分析 SDK、广告、账号服务或默认遥测。Electron 桌面应用启动只监听动态
`127.0.0.1` 端口的本地服务，并使用每次启动生成的随机桌面令牌。

模型请求、OAuth、模型发现、skills/packages 安装以及第三方扩展可能按用户操作访问网络；
具体数据处理由所选提供商与扩展决定。背景功能不会上传本地图片，也不接受远程背景 URL。
桌宠、TODO 和本机宠物扫描/导入本身不联网；快捷短语只有在用户明确点击发送后才可能访问
所选模型提供商。

删除或替换 portable EXE 不会清除用户数据。Windows 下 Electron 配置通常保留在
`%APPDATA%\piGUI`，导入的宠物副本位于 `%USERPROFILE%\.pi\agent\pi-gui`；Pi 自己的会话、
凭据和扩展仍位于 `%USERPROFILE%\.pi\agent`，不应为了清理 Piora 而整体删除。
详见 [隐私与网络行为](docs/open-source/PRIVACY_AND_NETWORK.md)。

## 项目结构与开发约束

架构、AgentSession 生命周期、分支、SSE、文件 allow-list、认证与扩展陷阱记录在
[AGENTS.md](AGENTS.md)。涉及这些区域的贡献在修改前必须阅读该文件。

本轮目标、验收与持续进度记录在
[今晚交付目标](docs/RELEASE_GOAL_2026-07-31.md)。Codex 与 Piora 的体验取舍见
[UX 对比报告](docs/CODEX_PI_GUI_UX_COMPARISON_2026-07-31.md)。
当前已经验证和仍待验证的边界见 [项目状态](docs/open-source/PROJECT_STATUS.md)。

## 贡献、支持与安全

- [贡献指南](CONTRIBUTING.md)
- [支持范围](SUPPORT.md)
- [安全政策](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [公开发布检查表](docs/open-source/LAUNCH_CHECKLIST.md)
- [上游关系](docs/open-source/UPSTREAM.md)

请不要在公开 issue 中提交 API Key、OAuth Token、私人提示词、Pi 会话、专有代码、主目录转储或
未脱敏日志。安全问题请使用 GitHub Private Vulnerability Reporting。

## 上游与许可证

项目代码使用 MIT License；保留的 pi-web 代码继续保留其 MIT 版权声明。Pi 与其他依赖保留
各自许可证。宠物兼容层对 OpenAI Codex TUI 宠物目录和动画/缓存约定的修改式适配依照
Apache-2.0 保留来源说明；它不是 OpenAI 官方集成，也不捆绑 Codex 宠物图像或品牌素材。
参见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[第三方包清单](THIRD_PARTY_LICENSES.md) 与
[Codex 兼容层归属](third_party/openai-codex/SOURCE.md)。

`upstream` 应继续指向 `https://github.com/agegr/pi-web.git`，上游更新必须审阅后再合并，
不能静默覆盖桌面安全边界或 Pi 兼容性处理。
