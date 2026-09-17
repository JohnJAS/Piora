# Piora / XiaoYiHarness 品牌构建

本功能对应 GitHub issue #105。当前为开发中实现：工作流和本地回归已接入，但尚未完成 GitHub Actions 实际打包、连续版本安装升级与全部运行时身份验收，不能据此宣称可以正式发布。

## 使用边界

这是同一个 App 的两种构建，不是两个独立产品。两者保留 `io.github.kexijiang.piora` AppId、内部 `Piora.exe`、Piora 用户数据目录、Agent 会话与配置、`persist:piora` 浏览器分区和单实例机制。手动安装另一品牌会覆盖或升级当前安装，不提供双安装、双开或数据隔离。

自动更新与手动换皮不同：Piora 只下载 Piora 包，XiaoYiHarness 只下载 XiaoYiHarness 包。Windows 安装版继续支持应用内升级；portable 和 Linux 不因此新增自动升级能力。

## 品牌选择与素材

`PIORA_BRAND` 未设置时默认为 `piora`；可选值为 `piora`、`xiaoyi-harness`。品牌只在构建阶段选择，不提供应用内切换设置，也不读取最终用户机器上的环境变量来切换品牌。

配置位于 `branding/<brand>/branding.json`。`displayName` 用于显示；品牌 ID、外部安装包前缀和更新清单是一组固定映射，不能混搭。

| 品牌 | 外部产物前缀 | stable 清单 | beta 清单 |
| --- | --- | --- | --- |
| Piora | `Piora` | `latest.yml` | `beta.yml` |
| XiaoYiHarness | `XiaoYiHarness` | `xiaoyi-latest.yml` | `xiaoyi-beta.yml` |

XiaoYiHarness 必须提供自己的 `icon.svg`。当前仓库内的图标仅为开发示例，正式发布前必须替换为确认的品牌素材。SVG 必须自包含，不能引用外部文件、脚本或活动内容。素材路径必须位于品牌自己的目录内。

可选素材字段：`trayIcon`（PNG）、`startupVideo`（MP4）、`startupPoster`（JPEG）、`portableSplash`（BMP）。缺少定制视频/海报时，启动页使用定制名称和静态图标；缺少定制 portable splash 时禁用旧 splash，不使用 Piora 视频或海报作为回退。

品牌准备生成 `.branding/`、Web/Electron 静态常量及 Web 图标。它不修改原始 Piora SVG 和视频。切换品牌时重新生成输出，保证 `piora → xiaoyi-harness → piora` 不残留上一品牌的已知启动资源。不要提交生成的常量或将定制图标覆盖提交为默认 Web 素材。

Web 与桌面编译分别记录品牌资源指纹。打包前要求两个编译记录均与当前资源一致，并验证 Web 的构建 ID 与已暂存输出一致；中途更换品牌、修改图标或只重编译一端时拒绝打包。此时应在 CI 中重新执行完整 `build:app`，不能手动修改编译记录绕过检查。

开发检查示例（PowerShell）：

```powershell
$env:PIORA_BRAND = 'xiaoyi-harness'
npm run brand:prepare
npm run typecheck
# 完成定制品牌检查后恢复默认生成资源
$env:PIORA_BRAND = 'piora'
npm run brand:prepare
```

不要在开发期间运行 `next build`；不要在本地打 release 包。完整打包仅由 GitHub Actions 执行。

## 更新隔离

两者从同一仓库 `kexijiang/Piora` 发布。XiaoYiHarness stable 只考虑正式版，preview 可选择更高的 beta 或正式版。选择器只探测候选 Release 的专属清单；404/410 跳过该版本，网络错误或非法 metadata 显示错误，绝不回退至 Piora 清单。

下载前校验版本、唯一安装包文件名、URL/path、SHA-512、文件大小及更新说明；收到 updater 的可用/已下载事件时再次验证品牌。不能仅给 Piora 清单改名后作为 XiaoYiHarness 清单使用。

更新资格和下载缓存分别保存：

| 状态 | Piora | XiaoYiHarness |
| --- | --- | --- |
| audience 文件 | `release-audience.json` | `release-audience-xiaoyi-harness.json` |
| updater 缓存 | `@pioradesktop-updater` | `xiaoyi-harness-updater` |

XiaoYiHarness 包内使用专属 `app-update-xiaoyi.yml`，在检查更新前指定给 updater；这样可以在不更改内部 npm 包名或 AppId 的前提下隔离缓存。普通业务设置仍然共用。

## 发布流程

第一期同版本、同标签、同 Release 双品牌发布。beta 工作流分别构建 Windows 安装版/portable；stable 工作流分别构建 Windows 安装版/portable/ZIP 和 Linux AppImage。矩阵任务使用各自 checkout 与输出目录。

保留标签、版本、源码 main 归属、锁文件、许可证和原有测试门禁。当前流程不支持绕过 main 校验直接从品牌开发分支发正式版本。所有发布说明仍由目标版本 `CHANGELOG.md` 生成，metadata 和 Release 正文必须一致。

构建产物按品牌分别上传为 Actions artifacts，发布任务禁止先平铺合并。`scripts/assemble-brand-release.mjs` 逐组验证文件集合、SHA-256 和已有说明副本，拒绝缺少品牌、外来文件、重复记录或校验失败，再生成统一 `SHA256SUMS.txt`。只有一个任务创建 Release，不覆盖已发布标签或资产。

后续若开放单品牌发布，只有 XiaoYiHarness 的正式 Release 不得设置为仓库 Latest，否则旧 Piora stable 客户端会找不到 `latest.yml`。当前 Atom 候选枚举有有限窗口；不承诺任意长时间单品牌漏发后仍可发现历史版本。

## 验证与待完成项

本地允许进行资源准备、类型检查、lint 与测试，不代替实机安装验收：

```powershell
node --test lib/branding-preparation.test.mjs lib/desktop-brand-updates.test.mjs lib/brand-builder-metadata.test.mjs lib/brand-release-assembly.test.mjs lib/brand-release-workflows.test.mjs
```

发布前还必须在 Actions 完成实际构建、两个连续 XiaoYiHarness 版本的安装升级、旧会话/设置保留、AppId 与 userData/sessionData/Agent 目录/partition/单实例兼容，以及下载、定时更新和安装前任务保护回归。开发示例图标和未完成的实际升级验收不能被标记为通过。

`brand-verification.yml` 是不发布 Release 的独立验证工作流。在隔离 checkout 中使用 `0.0.0-beta.1` / `0.0.0-beta.2` 测试版本，同步根/桌面 package、锁文件与测试更新说明，分别构建并验证，然后在托管 Windows runner 上连续安装。测试产物仅保留为短期 Actions artifacts，不创建标签，不拥有仓库发布写权限。成功时保存 `brand-upgrade-evidence`，其中记录版本、共享 AppId 对应的安装注册项、运行时路径、文件保留检查，以及打包应用通过只读会话 API 列举并加载旧消息的结果。该流程显式启用真实单实例锁：第一个进程保持运行时第二个进程必须被锁拒绝，再等待首个进程正常退出。以上项目尚待 Actions 实际执行，不能仅凭脚本存在标记通过。
