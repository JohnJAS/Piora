# Piora Stage 4 · Batch 5 验收记录

日期：2026-08-09

## 本批范围

- 打通“新建任务 → 输入 → 审批 → Review → Git 提交”的键盘和屏幕阅读器操作链路。
- 审批弹窗默认聚焦安全的“拒绝”操作；按 `Escape` 会执行拒绝并恢复原焦点，不会意外触发全局停止或让焦点逃离弹窗。
- `F6` 在侧栏任务搜索、对话输入框和已打开的右侧工作区标签之间循环；`Shift+F6` 反向循环。
- Review 文件列表支持方向键、`Home`、`End`、`Enter` 和空格；保留 `Alt+↑/↓` 作为跨区域快捷导航，并避免与普通方向键重复移动。
- Review 提交信息框支持 `Ctrl+Enter` / `Command+Enter` 提交，并为辅助技术提供快捷键说明。
- 右侧工作区标签支持 `←/→`、`Home`、`End`；关闭面板后通过 `inert` 和 `aria-hidden` 从焦点顺序及辅助技术树中移除。
- 任务完成后使用非打断式 live region 播报完成任务，且不抢夺当前输入焦点。
- Review 的变更树、分组、选中文件、差异区和审批键盘提示均补齐中英文语义。

## 安全与交互约束

- 审批弹窗仍采用焦点陷阱，安全操作优先。
- 浏览器验收只测试导航和焦点，没有执行暂存、取消暂存、回退、提交或其他 Git 写操作。
- 本批未运行 `next build`。

## 自动化验证

- 针对性回归：15 项全部通过。
- `npm test`：527 项，522 通过，0 失败，5 项因当前 Windows 账户不允许创建符号链接而跳过。
- `npm run typecheck`：Web 与 Desktop TypeScript 检查通过。
- `npm run lint`：通过。
- `npm run perf:check`：全部性能预算通过。
- `git diff --check`：本批文件无空白错误；仅提示现有 `AppShell.tsx` 行尾将由 Git 在后续操作时规范化。

## 浏览器验收

在 `http://127.0.0.1:30141` 验证：

1. 右侧面板关闭时，Review 标签和控件不会残留在辅助技术树或键盘焦点顺序中。
2. 从输入框按 `F6` 可聚焦 Review 标签；反向与循环导航正常。
3. 右侧标签按 `End` 可移动到 Search，按 `Home` 可返回 Review。
4. Review 列表普通 `ArrowDown` 只移动一项；`Alt+ArrowDown` 也只移动一项，不会发生双重导航。
5. 页面无 Next.js 错误覆盖层，也没有文档级横向溢出。

## 主要实现位置

- `components/AppShell.tsx`
- `components/ApprovalCard.tsx`
- `components/SessionSidebar.tsx`
- `components/sidebar/useSessionCatalog.ts`
- `components/workspace/ChangeList.tsx`
- `components/workspace/ReviewPanel.tsx`
- `components/workspace/RightPanel.tsx`
- `lib/review-keyboard.ts`
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`
