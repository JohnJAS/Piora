# Piora / XiaoYiHarness 品牌构建

本功能对应 GitHub issue #105。Windows 双品牌打包、真实运行时检查与 XiaoYiHarness 连续版本安装升级已通过非发布 Actions 验证。尚未正式发布；XiaoYiHarness 已选用 02「交织 H」图标，此次图标替换尚未重新打包验收，stable/Linux 发布矩阵尚未实跑。

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

XiaoYiHarness 使用自己的 `icon.svg`，对应已选定的 02「交织 H」方案：深色圆角底、白色 H 骨架与绿色连接带。源文件使用纯矢量形状，不含字体、脚本或外部引用；桌面 ICO、Web/PWA 图标和静态启动图均由它生成。素材路径必须位于品牌自己的目录内。

专用托盘使用 `trayIcon: "tray.png"`，保留可编辑源 `tray.svg`。它针对小尺寸加粗笔画并放大标志占比；品牌准备会生成包含 16/24/32/48/64/128/256 像素的 `tray.ico` 供 Windows 使用，其他平台使用 PNG。修改 SVG 后应重新导出 256×256 PNG；两份源素材需保持一致。未配置专用托盘时仍复用主图标，Piora 行为不变。

XiaoYiHarness 首次使用时，静态开屏从窗口显示起至少保留 5 秒，期间隐藏跳过按钮。完成后在用户数据目录的 `desktop-state.json` 中保存独立的 `xiaoyiStartupShown` 标记，与 Piora 的版本启动记录无关；后续启动、版本升级不再强制等待。服务加载超过 5 秒时继续等待服务，加载失败或提前关闭不记录完成；隔离的打包冒烟测试不消耗该标记。Piora 原视频开屏行为不变。

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

2026-09-17，提交 `c79994c45753ab32d9ebb97da48b200414313270` 的 [Actions 验证运行](https://github.com/JohnJAS/Piora/actions/runs/35206131448) 全部通过：

- Piora beta.1 与 XiaoYiHarness beta.1/beta.2 的 Windows NSIS/portable 构建、清单/哈希/说明、运行包及真实窗口品牌检查。
- XiaoYiHarness beta.1 → beta.2 实际覆盖安装；两次安装注册项保持相同 AppId 派生 GUID 和安装路径，名称及版本正确。
- 三份预置文件逐字节保留；旧会话在升级前后均可经应用 API 列举并读取消息。
- 在隔离测试资料目录中，userData/sessionData/Agent 根保持一致，partition 为 `persist:piora`；两版均实际验证第二实例被拒绝。

这不是通过已发布 Release 下载触发的自动升级，也未实跑 stable/Linux 发布矩阵或用户真实资料迁移。更新选择、串包拒绝、资格隔离及安装前保护有针对性回归；正式发布仍需确认素材并执行对应发布门禁。本地全量测试此前仍有三项 PowerShell/PTY 环境相关失败，不能宣称全量测试全部通过。

`brand-verification.yml` 是不发布 Release 的独立验证工作流。在隔离 checkout 中使用 `0.0.0-beta.1` / `0.0.0-beta.2` 测试版本，同步根/桌面 package、锁文件、许可证清单与测试更新说明，分别构建并验证，然后在托管 Windows runner 上连续安装。测试产物仅保留为短期 Actions artifacts，不创建标签，不拥有仓库发布写权限。成功时保存 `brand-upgrade-evidence`，其中记录版本、共享 AppId 对应的安装注册项、运行时路径、文件保留检查，以及打包应用通过只读会话 API 列举并加载旧消息的结果。该流程显式启用真实单实例锁：第一个进程保持运行时第二个进程必须被锁拒绝，再等待首个进程正常退出。
