# XiaoYiHarness 官网

基于 Piora 仓库 `website/` 的独立品牌站，使用深墨色、薄荷绿视觉与真实工作区截图，保留产品功能介绍。源码位于本仓库 `website-xiaoyi/`，依赖与构建独立管理。

公开网址：

- Vercel：https://xiaoyiharness.vercel.app
- Sites：https://xiaoyiharness.sjjworkspace.chatgpt.site

## 下载与链接

- 产品名称、图标、网页标题、站点地图、Web Manifest、结构化数据和 AI 文档使用 XiaoYiHarness。
- 源码、问题反馈、许可证与发行说明使用真实的共享仓库 `kexijiang/Piora`；没有虚构独立的 XiaoYiHarness GitHub 仓库。
- 下载按钮严格按 `XiaoYiHarness-<version>-<platform>` 全名匹配，并核对 GitHub 下载地址，不会选中同一发行版中的 Piora 安装包。
- 页面访问时读取 GitHub 最新正式版；仅接受包含四种 XiaoYiHarness 下载格式的版本。接口失败或品牌产物缺失时，保留 `app/release-snapshot.json` 中已核验的 v0.5.1。
- ZIP 内部可执行文件仍名为 `Piora.exe`，与实际发行包一致。

## 开发与部署

先进入 `website-xiaoyi/`，使用 Node.js 22.13.0 或更新版本，运行 `npm ci` 安装锁定依赖，`npm run dev` 预览；`npm run check` 执行 ESLint、TypeScript 与下载筛选测试。

Sites 使用 `npm run build`（Vinext / Cloudflare Worker）生成发布产物。
`.openai/hosting.json` 保存该独立站的 ID，不要替换成原 Piora 站点 ID。

GitHub 提交与 PR 不会自动更新线上站点。目前发布需要将此目录同步到该站点关联的 Sites 源码仓库，再构建、保存站点版本并发布到现有站点；无需创建新站点。构建输出位于 `dist/`，不提交依赖、生成文件或部署凭据。

### Vercel

从 GitHub 导入本仓库时，Vercel 项目的 Root Directory 使用 `website-xiaoyi/`，框架预设使用 Next.js；从下述 CLI 命令部署时，上传根目录就是当前官网目录。目录内的 `vercel.json` 指定 `npm ci` 安装依赖、`npm run build:vercel` 构建；Vercel 在云端执行构建。`postcss.config.mjs` 为 Next.js 提供 Tailwind CSS 支持。

现有独立项目为 `innovation-tea/xiaoyiharness`。运行 `npx vercel login` 登录，进入 `website-xiaoyi/` 后运行 `npx vercel deploy --prod --yes --project xiaoyiharness --scope innovation-tea`。勿关联到 Piora 项目。当前使用 CLI 发布，尚未配置 GitHub 自动部署。

页面规范网址、站点地图和 robots 默认读取 Vercel 的 `VERCEL_PROJECT_PRODUCTION_URL`；绑定自定义域名后可设置 `NEXT_PUBLIC_SITE_URL` 覆盖。Sites 继续使用现有网址与 `npm run build:sites`，默认 `npm run build` 也仍面向 Sites。

## 来源

原站源码：https://github.com/kexijiang/Piora/tree/main/website
基础版本：c6f34ee0df0ffa5235a64dcd2fd22504157d552b。
品牌图标取自该仓库 `branding/xiaoyi-harness/icon.svg`；保留 MIT 许可证。
