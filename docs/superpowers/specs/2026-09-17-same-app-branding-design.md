# 同 App 换皮构建设计：Piora / XiaoYiHarness

## 状态

- 提案：待实现
- 范围：仅打包前选择品牌
- 默认构建：Piora
- 可选构建：XiaoYiHarness
- 身份模型：同一个 Electron 应用，不创建第二个产品身份

## 目标

在保持 Piora 运行身份、数据、协议、更新逻辑和核心代码不变的前提下，通过构建配置替换用户可见的产品名称、图标和启动资源。未设置配置时，构建结果与当前 Piora 完全一致；设置 `PIORA_BRAND=xiaoyi-harness` 时，构建结果显示为 XiaoYiHarness。

```powershell
$env:PIORA_BRAND = "xiaoyi-harness"
npm run dist:win
```

安装后的用户不能切换品牌。品牌在构建阶段确定，运行时只读取随包生成的静态品牌数据。

## 产品身份与限制

Piora 和 XiaoYiHarness 使用相同的：

- Windows AppId：`io.github.kexijiang.piora`
- Electron `userData`：`%APPDATA%\\Piora`
- agent 数据目录、session、模型配置和登录凭证
- 浏览器 partition：`persist:piora`
- 单实例锁、协议、数据库和扩展 id
- 更新仓库、更新 channel 和自动更新身份

这意味着两个品牌不能同时安装或运行。安装 XiaoYiHarness 会覆盖或升级 Piora，反之亦然；已有数据、设置、缓存和登录状态继续复用。

## 可配置范围

只允许覆盖用户可见品牌和视觉资源：

```json
{
  "id": "xiaoyi-harness",
  "displayName": "XiaoYiHarness",
  "windowTitle": "XiaoYiHarness",
  "startupTitle": "XiaoYiHarness",
  "assets": {
    "icon": "icon.svg",
    "trayIcon": "tray.png",
    "startupVideo": "startup.mp4",
    "startupPoster": "startup.jpg",
    "portableSplash": "portable-splash.bmp"
  },
  "web": {
    "title": "XiaoYiHarness"
  }
}
```

不允许配置覆盖 `appId`、`userData`、数据目录、partition、更新仓库、协议名或内部产品 id。这样可以确保换皮不会变成数据迁移或身份迁移。

## 品牌目录与回退

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

Piora 是完整默认配置。XiaoYiHarness 可以只提供差异字段和差异文件，缺失字段及资源回退到 Piora。未知 brand id、非法配置或资源校验失败时，构建应失败并明确报告；只有未设置 `PIORA_BRAND` 时才静默使用 Piora。

## 统一解析器

增加统一的 `BrandingConfig` 解析模块，供构建脚本、Electron 主进程和 Next.js 使用。业务代码不得直接读取 JSON 或散落硬编码品牌名。

解析器负责：

1. 读取 `PIORA_BRAND`，默认 `piora`。
2. 加载默认配置和选定品牌配置并合并差异。
3. 只接受允许覆盖的字段，拒绝身份字段。
4. 校验资源路径位于品牌目录内。
5. 校验文件格式、大小和文案长度。
6. 输出构建期和运行期都可序列化的标准配置。

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

品牌准备步骤生成当前构建需要的兼容路径：

```text
desktop/build/icon.ico
desktop/build/icon.png
desktop/build/tray.png
desktop/build/portable-splash.bmp
desktop/build/startup/*
public/icons/*
app/favicon.ico
```

现有 `scripts/build-brand-icon.mjs` 改为读取当前品牌 SVG；`startup-scene.ts` 改为读取当前品牌视频、海报和文案。打包结束后应清理或覆盖生成目录，避免上一次品牌的资源残留。

## Electron 与 Web 接入

用户可见文本从 `BrandingConfig` 获取：

- 主窗口、companion 和剪贴板窗口标题
- 启动页标题、状态文本和按钮
- 托盘 tooltip、菜单和通知
- 关于、更新、错误和服务停止对话框
- 桌面快捷方式显示名
- Web `<title>`、manifest、favicon、AppShell 顶部标题

内部文本、协议和文件标识继续使用 Piora 兼容名称。例如 `piora-clipboard`、`piora-browser`、日志目录和数据备份扩展名不改。

## electron-builder 处理

由于是同一个 App，保持：

```yaml
appId: io.github.kexijiang.piora
```

以下字段可根据品牌改变：

- `productName`
- NSIS `shortcutName`
- NSIS `uninstallDisplayName`
- 安装包和 portable artifact 的显示名称
- Windows/Linux/Web 图标

建议保持稳定的 `executableName: Piora`，避免已有快捷方式、便携版检测和脚本因 exe 文件名变化而失效。文件名若确实需要随品牌改变，必须另行增加旧文件名兼容规则。

## 启动资源规则

启动资源按品牌打包到固定的 `resources/startup` 位置：

1. MP4 存在且通过校验时播放。
2. MP4 缺失、过大或损坏时使用 JPG 海报。
3. 海报缺失时使用品牌背景色 fallback。
4. 减少动画偏好继续跳过视频。
5. 首次启动、版本更新和后续启动规则保持现有行为。

便携版原生 splash 使用品牌专属 BMP；它发生在网页加载前，必须在构建阶段替换。

## 更新风险与发布规则

因为两个构建使用相同 AppId 和更新身份，同一更新 feed 中发布不同品牌会导致用户在更新后换肤。必须选择并固定一种规则：

- **单一品牌发布流**：当前发布的品牌成为所有用户下一次更新后的品牌，适合内部换肤或阶段性品牌切换。
- **按品牌区分 manifest**：仍共用 AppId，但 Piora 与 XiaoYiHarness 使用不同的 manifest 地址或 channel，避免自动更新互相换肤。

推荐第二种。构建配置可以选择 manifest 路径，但仓库、签名和 AppId 仍保持 Piora 现有身份。手动安装另一品牌包仍会覆盖当前安装，这是同一 App 的预期行为。

## 验收标准

- 未设置 `PIORA_BRAND` 时，Piora 构建、运行和发布行为不变。
- `PIORA_BRAND=xiaoyi-harness` 只改变显示名称、图标、启动视频、海报、portable splash 和相关用户可见文案。
- AppId、exe 内部身份、userData、agent 数据、partition、协议、更新逻辑和核心 API 不变。
- Piora 与 XiaoYiHarness 不能并行安装，安装任一品牌会覆盖另一品牌。
- 缺失品牌资源回退到 Piora；构建目录不会残留上一次品牌资源。
- Windows 安装包、portable、Web、托盘和启动页显示名称及图标一致。
- 更新 feed 不会在未明确选择的情况下把品牌自动切换到另一套资源。
- 增加品牌配置、资源回退和打包品牌验证测试。

## 实施顺序

1. 增加默认 Piora 和 XiaoYiHarness 差异配置。
2. 增加只允许显示层字段的 brand loader 和校验。
3. 改造图标、favicon、启动媒体和 portable splash 生成。
4. 接入 Electron/Web 用户可见名称和资源。
5. 让 electron-builder 动态注入 `productName`、快捷方式名称和图标，同时锁定 AppId 及数据身份。
6. 增加打包资源清理、品牌矩阵测试和更新 feed 检查。

## 与独立产品方案的区别

本方案不改变 AppId、数据目录、更新身份和可执行文件内部身份，因此不需要数据导入，也不支持两个品牌并行安装。它适合“同一个应用的不同定制包”；如果未来需要独立安装、独立升级或独立数据，再回到独立产品方案。
