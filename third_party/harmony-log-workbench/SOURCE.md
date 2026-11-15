# 日志工作台来源

- 上游：<https://github.com/Alentaoker/dsh-harmoneydev-tools>
- 固定提交：`8b178a755d33cee9899160a7be283af2b23eb85d`
- 版本标识：`0.6.0-rc.1` 后的 main 源码；本次没有引入上游投屏二进制、SDK 或 HiLog 字典。
- 日志库、压缩包读取、搜索与离线界面来源：`plugin/dsh-e2e/src`，Apache-2.0，完整许可见 `LICENSE-APACHE-2.0`。
- 实时界面、环形缓冲、应用匹配、搜索历史来源：`plugin/dsh-harmony/vendor`，MIT，完整许可见 `LICENSE-MIT`。该模块本身基于 Piora，保留其原始版权。
- 适配文件：`lib/harmony/log-library/vendor/`、`lib/harmony/log-{buffer,application,workbench-filter,search-history,download}.ts`、`components/workspace/harmony/log-workbench/`。
- 改动：移除 DSH/Cordis 宿主依赖，换用 Piora 会话及桌面认证；新增 Next 路由与草稿适配；限定组件样式并改用主题变量；补充 React 19 类型兼容；保留分块、后台任务预算与会话隔离。
- 后续适配与测试以本仓库源码为准；上游性能及真机验收记录不代表 Piora 已通过相同验收。

ZIP 使用 `yauzl@3.4.0`（MIT），RAR 使用 `7z-bin@26.6.0` 的原样二进制（封装 MIT；二进制保留 7-Zip LGPL/BSD/unRAR 条款）。版本与完整性由根锁文件固定；依赖的许可证随桌面许可包保留。仅使用 RAR 解码，不创建 RAR。

7-Zip 26.06 的 Windows x64 EXE、DLL 和 License.txt 已与 [官方发行包](https://github.com/ip7z/7zip/releases/tag/26.06) 解出的文件逐字节比对。上游发布资产、完整对应源码与文件 SHA-256 记录在 [7zip-runtime.json](7zip-runtime.json)，打包验证同时核对实际 ASAR sidecar 的二进制和许可证。`LICENSE-7ZIP` 与上游 Windows License.txt 仅换行格式不同；原有 LGPL/BSD/unRAR 条款不变。

官方 `hilogtool` 和配套字典由用户本机提供。本次仅保存工具路径，不复制、分发 SDK 内容。
