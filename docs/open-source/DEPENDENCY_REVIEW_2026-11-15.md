# PR #432 依赖兼容审查

独立审查基线：`4ee2e3723ff52914671fc9581d1083f9d2e00ad4`；Dependabot 输入：`d2de0ab5005072170a0cb5ffdcfc579bdf7537ce`。未使用 #427 的补丁或测试结果。仅在云端独立工作树验证；未发布版本或部署。

## 来源与兼容性

锁文件本次变更的所有 npm 包均逐项查询 `registry.npmjs.org/<name>/<version>`，确认 integrity 与官方元数据一致，再将镜像 resolved 地址改为官方 tarball 地址。Electron workspace 的声明恢复为准确版本，minimatch 的 brace-expansion override 跟随根依赖；Pi 自身锁定的 5.0.12 继续由严格 postinstall 替换为 5.0.13。审计和许可清单同时核验替换前后身份及实际文件，未屏蔽任何公告。

| 依赖 | 审查结论与验证 |
| --- | --- |
| brace-expansion 5.0.13 | [上游差异](https://github.com/juliangruber/brace-expansion/compare/v5.0.12...v5.0.13) 增加共享工作量预算、处理 NaN 限制并优化重复扫描。MIT 不变。测试应用与 Pi 实际解析路径的普通 glob、对抗嵌套、NaN 和预算边界，保留未知版本拒绝、补丁幂等性和文件完整性断言。 |
| Next / eslint-config-next 16.4.6 | [响应压缩变更](https://github.com/vercel/next.js/commit/7d0dc76f288c24deac0682b4929774efded501a7) 将单值响应头从数组改为字符串，使压缩中间件开始处理 route handler。所有 SSE 增补 `Cache-Control: no-transform`；通过真实 Next `sendResponse`、`NodeNextResponse` 和 bundled compression 的 HTTP 测试，确认客户端声明 gzip 时首事件先于流关闭到达、后续事件完整。普通响应压缩配置保持启用。eslint-config-next 两版 tarball 除 package.json 外逐文件相同。MIT 不变。 |
| tar 7.5.23 | [上游差异](https://github.com/isaacs/node-tar/compare/v7.5.22...v7.5.23) 仅发布工作流及版本信息变化。下载两版官方 tarball，除 package.json 外逐文件相同，既有运行时修复未丢失。npm provenance payload 指向 `isaacs/node-tar`、`refs/tags/v7.5.23`、`.github/workflows/release.yml`、提交 `eb92e178af52cd191d48eb70a846f61cc4dade1b`，与上游 tag 和 OIDC 发布迁移相符；此处是 payload/source 一致性核对，不宣称另做了 Sigstore 签名验证。BlueOak-1.0.0 不变。gzip 中文文件往返及父目录穿越拒绝实测通过。 |
| typebox 1.4.6 | [上游差异](https://github.com/sinclairzx81/typebox/compare/1.4.5...1.4.6) 修正 Diff 的 JSON Pointer 转义及 typed-array/null 路径，Pointer.Indices 改名为 Fragments；本项目未使用旧名。Type 工具输入 schema、Check、Diff/Patch 回归通过。MIT 不变。 |
| ws 8.22.2 | [上游差异](https://github.com/websockets/ws/compare/8.22.1...8.22.2) 修正 URL userinfo 解码、避免修改调用者 URL、释放 frame buffer 引用。真实 loopback WebSocket 验证编码凭据、原 URL 不变及消息收发。MIT 不变。 |
| winappcli 0.8.0 | 审阅 [发布源码](https://github.com/microsoft/WinAppCli/tree/v0.8.0/src/winapp-CLI/WinApp.Cli/Commands) 和官方 tarball 生成的 CLI wrappers。现有 invoke `--action`、set-value 两个 positional、wait-for `--timeout/--value/--gone`、scroll `--direction/--to` 仍有效；新增 desktop coordination 不改变这些参数。适配器和包内版本检查同步到 0.8.0。增加 Windows 真实二进制版本、list-windows 和所有适配操作的只读 help/parser 验证；Windows 缺失二进制会失败。MIT 不变。Linux 不支持运行该 exe，留给 Windows CI。 |
| Electron 45.3.1 | 核对 [45.3.0](https://github.com/electron/electron/releases/tag/v45.3.0) 与 [45.3.1](https://github.com/electron/electron/releases/tag/v45.3.1)：包括 Windows 隐藏窗口、权限回调与 webRequest 循环修复，及撤销的 eMudhra 中间证书处理。MIT 不变。使用其校验和清单安装 Linux binary，`ELECTRON_RUN_AS_NODE` 实际返回 Electron 45.3.1 / Node 24.22.2 / Chromium 156.0.8078.96；未据此宣称 Windows 原生窗口验证通过。 |
| 7z-bin 26.6.0 | 官方 npm tarball 完整性与 provenance 中的仓库/发布提交 `f7cdf359639ef40a36779f7160b1890c2be8512b` 已核对。包内 Linux x64 7zzs、Windows x64 EXE/DLL/License.txt 与 [7-Zip 26.06 官方发布资产](https://github.com/ip7z/7zip/releases/tag/26.06) 解出文件逐字节相同；官方资产 SHA-256 与 GitHub release digest 相同。包装器 MIT，二进制仍适用 LGPL/BSD/unRAR，不能按单一 MIT 描述。新增 [固定哈希清单](../../third_party/harmony-log-workbench/7zip-runtime.json)，实际 ASAR sidecar 也检查字节和许可证。RAR4/RAR5 真实解压、非法路径/链接/加密/超限拒绝测试通过。 |

7z-bin 的 Node ≥24 声明在 26.4.0 已存在；两版 `dist` 包装器逐文件相同（仅使用 node:path、process 和 import.meta.dirname）。本次保持仓库 Node 22.19.0 范围，实测其实际使用路径和 RAR 二进制。正常 npm ci 仍打印该上游 engine 警告：这是一项明确保留的上游支持范围差异，测试通过并不改变包作者的支持声明。打包 Electron 内置 Node 24.22.2 满足声明。

## 本地验证记录

- 使用 Node 22.19.0 / npm 10.9.3，正常 `npm ci` 和全部 postinstall 通过。此前安装尝试分别发现锁文件未同步、node-gyp cache 不可写、缺少 patchelf；通过同步锁文件、任务临时 cache 和临时安装 patchelf 0.19.3 修复，未跳过安装脚本。`--ignore-scripts` 仅用于一次 package-lock-only 元数据重算，不作为安装通过结果。
- 定向回归 80 项：78 通过，2 项 Windows 二进制测试因 Linux 平台未运行。覆盖 SSE、依赖行为、补丁安全、运行时审计、许可清单、包内校验、真实日志归档和直接依赖锁定。随后新增的 7-Zip sidecar 哈希/篡改检查复测通过。
- `next typegen`、根与桌面 typecheck、完整 lint、license inventory 生成/检查、changelog 片段检查通过；Harmony worker 和 desktop 测试夹具编译通过。
- `audit:runtime` 按现有 high 门槛通过，报告 7 项 moderate；未运行 audit fix、降低门槛或忽略公告。
- 额外桌宠/表情/安全/归档组 35 项：34 通过，1 项桌宠孤儿进程生命周期测试在 Linux 容器超时；现场出现父进程退出后由 PID 1 持有的 zombie，未将其记为通过。Windows 对应测试仍须 CI 验证。
- 本地 release hygiene 在已有 SkillsConfig 浏览器测试夹具的一处固定 home 路径命中本机 home 扫描；该文件与基线相同，未修改扫描规则或掩盖结果。远端 hygiene 结果单独追踪。
- 未运行本地完整测试套件、Windows 安装包/原生窗口验证或硬件验收，未在开发目录执行 Next production build。必需检查的最终准确 head 结果以 PR Actions 为准，旧 head 的机器人结论不计入本次审查。
