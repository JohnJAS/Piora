# 独立品牌构建与发布设计：Piora / 小艺Harness

## 状态

- 提案：已确认
- 范围：仅打包前选择品牌
- 默认品牌：Piora
- 目标品牌：小艺Harness（独立产品）

## 目标

让同一套代码可以在构建阶段选择不同品牌，并生成完整一致的独立桌面产品。未设置品牌时必须保持现有 Piora 行为；选择 `xiaoyi-harness` 时，安装包、可执行文件、快捷方式、窗口、托盘、通知、启动动画、图标、Web metadata、数据目录和更新源都使用小艺Harness身份。

安装后的用户不修改品牌配置。Windows 可执行文件元数据、安装包名称、卸载项、系统图标、AppUserModelId 和数字签名均在构建阶段确定。

## 非目标

- 不在运行时支持把已安装的 Piora 改名为小艺Harness。
- 不修改 `piora-*` 协议、session 格式、数据库格式和扩展 id。
- 不让小艺Harness读取 Piora 的更新源。
- 不在第一版自动合并两个产品的会话数据。

## 产品身份

| 字段 | Piora | 小艺Harness |
| --- | --- | --- |
| brand id | `piora` | `xiaoyi-harness` |
| display name | Piora | 小艺Harness |
| Windows AppId | `io.github.kexijiang.piora` | 独立 AppId，例如 `com.xiaoyi.harness` |
| data directory | `Piora` | `XiaoyiHarness` |
| browser partition | `persist:piora` | `persist:xiaoyi-harness` |
| update repository | Piora | 小艺Harness独立仓库 |

界面显示使用中文产品名，文件系统目录和可执行文件使用稳定英文 slug，避免 Windows 路径和工具链的兼容问题。

## 配置结构

新增品牌目录：

```text
branding/
├─ piora/
│  ├─ branding.json
│  ├─ icon.svg
│  ├─ tray.png
│  ├─ startup.mp4
│  ├─ startup.jpg
│  └─ portable-splash.bmp
└─ xiaoyi-harness/
   ├─ branding.json
   ├─ icon.svg
   ├─ tray.png
   ├─ startup.mp4
   ├─ startup.jpg
   └─ portable-splash.bmp
```

`branding.json` 至少包含：

- `id`, `displayName`, `shortName`, `englishName`
- `publisher`, `appId`, `executableName`, `dataDirectoryName`
- `release.owner`, `release.repo`, `release.channel`
- `window.titleTemplate`, `window.defaultTitle`
- `startup.enabled`, `startup.showOnFirstLaunchOfVersion`
- `startup.video`, `startup.poster`, `startup.splash`
- `assets.icon`, `assets.trayIcon`
- `theme.accent`, `theme.startupBackground`
- 中英文启动、跳过动画、关于和更新文案

构建选择：

```powershell
$env:PIORA_BRAND = "xiaoyi-harness"
npm run dist:win
```

未设置或指定未知 brand id 时回退到 `piora`，并在构建日志中报告回退原因。

## 配置解析边界

新增统一品牌解析模块（建议 `lib/branding.ts`，桌面端通过构建产物或等价适配层读取）。业务代码不直接读取 JSON。

解析器负责：

1. 读取 `PIORA_BRAND`。
2. 校验 brand id、AppId、文件名和文案长度。
3. 加载品牌配置并合并默认值。
4. 校验所有资源路径位于对应品牌目录内。
5. 校验图标、视频和 splash 的大小与格式。
6. 输出供构建脚本、Electron 主进程和 Web 使用的标准 `BrandingConfig`。

## 构建流程

```text
resolve-brand
  → validate-brand
  → generate-brand-assets
  → build:web
  → build:desktop
  → electron-builder
  → verify-packaged-brand
```

品牌资源生成阶段输出：

```text
desktop/build/icon.ico
desktop/build/icon.png
desktop/build/portable-splash.bmp
desktop/build/startup/*
public/icons/*
app/favicon.ico
```

`scripts/build-brand-icon.mjs` 改为读取当前品牌的 SVG，并生成 Windows ICO、Linux PNG、托盘/网页图标和 favicon。启动资源改为从当前品牌目录复制或读取，不再固定依赖 `polaris-rover.*`。

electron-builder 的以下字段由当前品牌生成：

- `appId`, `productName`, `copyright`
- Windows/Linux 图标
- Linux `executableName`
- NSIS `shortcutName`, `uninstallDisplayName`
- NSIS、portable、Linux artifact 名称
- 发布 owner、repo、channel

可以生成 `desktop/build/electron-builder.generated.yml`，再由现有配置继承，避免直接在 YAML 中实现复杂逻辑。

## Electron 运行时

`desktop/src/main.ts` 及相关桌面模块从 `BrandingConfig` 获取所有用户可见品牌：

- 主窗口和 companion 窗口标题
- 启动失败、服务退出和更新对话框
- 应用菜单、托盘 tooltip 和菜单
- 任务完成、用户输入和更新通知
- 关于页面
- 快捷方式描述
- 日志目录显示和诊断文本

窗口标题使用模板，例如 `{project} - {app}`。内部协议保持兼容：`piora-clipboard`、`piora-browser`、`piora-prompt-recovery` 等不随品牌变化。

## 数据隔离与单实例

品牌身份决定 Electron `userData`、浏览器 partition、窗口状态、更新状态、日志、剪贴板数据库和默认 agent 数据目录。Piora 与小艺Harness必须可以同时安装并运行，不能共享 Cookie、缓存、单实例锁或更新状态。

## Web 接入

构建时把同一品牌配置注入 Next.js：

```text
NEXT_PUBLIC_PIORA_BRAND=xiaoyi-harness
```

以下内容从品牌配置生成：

- `app/layout.tsx` 的 title、applicationName 和 icons
- `app/manifest.ts` 的 name、short name 和 icons
- `app/global-error.tsx` 的标题
- `components/AppShell.tsx` 的窗口标题、顶部名称和更新提示

## 启动动画与图标

启动媒体支持 MP4、静态海报和纯色 fallback。规则如下：

1. MP4 存在且有效时播放。
2. MP4 缺失、过大或损坏时使用海报。
3. 海报缺失时使用品牌背景色。
4. 减少动画偏好会跳过视频。
5. 默认只在首次启动或版本更新时播放。

便携版原生 splash 使用品牌专属 BMP，因为它发生在网页加载前，不能通过 HTML 动态切换。

图标资源需要分别验证 16、24、32、48、64、128、256 像素 Windows ICO，以及 Linux、托盘、任务栏和 Web favicon 场景。

## 更新与发布

小艺Harness拥有独立 GitHub Release 仓库、更新 manifest、artifact 命名和发布说明。构建与发布检查必须验证：

- 安装包与 AppId 匹配
- `latest.yml` / `beta.yml` 指向正确仓库和产品名
- 更新说明与目标版本 CHANGELOG 一致
- 安装包、portable、快捷方式和卸载项使用小艺Harness
- Piora 不会接收小艺Harness的更新，反之亦然

## 数据迁移

由于是独立产品，小艺Harness默认不读取 Piora 数据。后续建议加入“从 Piora 导入”入口，先备份、不覆盖已有数据、记录来源并支持失败回滚。第一版可以先不实现自动迁移，但设计需保留入口和版本兼容边界。

## 测试与验收

新增配置测试、桌面品牌测试和打包品牌验证脚本，覆盖：

- Piora、小艺Harness、未知 brand id
- 缺失/损坏图标、海报和视频
- Windows NSIS、portable、Linux AppImage
- 启动动画、托盘、快捷方式、卸载项
- 两个品牌同时启动和数据目录隔离
- Web title、manifest、favicon 一致
- 更新仓库、channel、artifact 名和更新元数据一致

建议新增：

```text
lib/branding-config.test.mjs
lib/desktop-branding.test.mjs
scripts/verify-packaged-brand.mjs
```

## 实施顺序

1. 品牌 schema、默认 Piora 配置和小艺Harness配置。
2. 统一 brand loader 与资源校验。
3. 图标、favicon、启动媒体和 portable splash 构建切换。
4. Electron 主进程、托盘、通知、窗口标题和数据目录接入。
5. Web metadata 和 AppShell 接入。
6. electron-builder 动态配置、独立 AppId 和发布源。
7. 打包验证、双产品并行运行验证和更新元数据验证。
8. 后续增加 Piora → 小艺Harness 数据导入。

## 决策记录

- 品牌只在打包前选择，不支持安装后换品牌。
- 小艺Harness是独立产品，不覆盖 Piora 安装，也不复用 Piora AppId。
- 用户可见品牌全部配置化；内部协议和历史数据格式保持 Piora 兼容标识。
