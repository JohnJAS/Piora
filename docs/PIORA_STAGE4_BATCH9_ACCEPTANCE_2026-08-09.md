# Piora Stage 4 · Batch 9 验收记录

日期：2026-08-09

## 本批范围

- 按项目恢复已打开的文件标签与活动标签，刷新页面或离开后返回项目时不必重新寻找工作文件。
- 按 cwd 恢复文件树展开目录，普通刷新不会清空浏览上下文。
- 继续复用既有侧边栏宽度、文件面板宽度和工作区活动页签持久化，完成“面板与标签状态”剩余项。
- 工作区切换时，用户选择保留的脏标签优先于目标项目恢复状态；相同文件不会重复打开。
- 浏览器存储不可用、超限或损坏时安全降级为空状态，不阻断项目切换、文件打开或目录展开。

## 数据与安全边界

- 使用版本化、按工作区散列分区的本地状态；记录内仍保存并验证原始工作区根目录，散列冲突时失败关闭。
- 最多保存 24 个文件标签和 200 个展开目录，原始 JSON 上限为 128 KiB。
- 只接受工作区根目录内的标签路径、标签 cwd 和展开目录；拒绝前缀伪装、跨盘路径、重复项与畸形字段。
- 仅保存文件标签元数据，不保存编辑器正文、未保存草稿、会话内容、凭据或自定义资源。
- 文件标签恢复后由原有文件 API 重新读取磁盘内容，未绕过 allowed-root 校验。

## 自动化验证

- 专项回归：11 项通过，0 失败。
- `npm test`：551 项，546 通过，0 失败，5 项因当前 Windows 账户不允许创建符号链接而跳过。
- `npm run typecheck`：Web 与 Desktop TypeScript 检查通过。
- `npm run lint`：通过。
- `npm run perf:check`：全部性能预算通过。
- `git diff --check`：通过。
- 未运行 `next build`。

## 主要实现位置

- `lib/workspace-continuity.ts`
- `lib/workspace-continuity.test.mjs`
- `components/AppShell.tsx`
- `components/FileExplorer.tsx`
- `components/WorkspaceContinuity.test.mjs`
