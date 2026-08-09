# Piora Stage 4 · Batch 6 验收记录

日期：2026-08-09

## 本批范围

- 大型 Review 变更列表改为选中项驱动的窗口化渲染，每个窗口最多 60 项。
- 当前选中项是唯一窗口锚点，不额外保存可能与 Git 状态失步的分页副本。
- 提供“上一批 / 下一批”入口和“显示第 x–y 项，共 n 项变更”状态。
- 普通方向键、`Home`、`End` 和 `Alt+↑/↓` 可以跨窗口选择文件；目标窗口渲染后自动恢复焦点并滚动到可见位置。
- 每个渲染条目通过 `aria-posinset` / `aria-setsize` 暴露其在完整分组中的位置；分组使用命名的 `role=group`。
- 变更列表成为独立滚动区，暂存、撤销和提交控件保持固定，翻页按钮不会被底部操作区遮挡。
- 新增 10,000 项 Review 窗口计算性能预算。

## 实现约束

- 窗口计算位于 `lib/review-progressive.ts`，为 O(1) 纯函数。
- React 只从 `items` 与 `selectedKey` 派生当前窗口，没有使用 Effect 同步重复状态。
- 页面窗口变化不改变勾选路径集合、Git 状态或 Diff 数据源。
- 移动端保持整块侧栏滚动，避免有限高度下固定操作区挤空变更列表。

## 自动化验证

- 专项回归：18 项全部通过；独立滚动区补充 4 项组件断言中的相关覆盖。
- `npm test`：534 项，529 通过，0 失败，5 项因当前 Windows 账户不允许创建符号链接而跳过。
- `npm run typecheck`：Web 与 Desktop TypeScript 检查通过。
- `npm run lint`：通过。
- `npm run perf:check`：全部性能预算通过。
- 10,000 项 Review 窗口计算：0.01ms / 50ms。
- `git diff --check`：本批文件无空白错误；仅有仓库现存行尾规范化提示。

## 浏览器验收

在 `http://127.0.0.1:30141` 使用当前真实的 242 项 Git 变更验证：

1. 首屏只渲染 60 个 Review treeitem，范围显示为 1–60 / 242。
2. 点击“下一批 60 项变更”进入 61–120 / 242，DOM 仍保持 60 个 Review treeitem。
3. 从第二批首项按 `ArrowUp` 返回第一批末项，焦点仍位于选中的 treeitem。
4. 按 `End` 直接进入 241–242 / 242，DOM 只保留最后 2 个条目。
5. 独立滚动后翻页按钮可真实点击，底部暂存和提交区不遮挡按钮。
6. 页面有有效内容，无 Next.js 错误覆盖层、无浏览器页面错误、无文档级横向溢出。

## 安全说明

- 浏览器验收没有勾选文件，也没有执行暂存、取消暂存、撤销或提交。
- 未运行 `next build`。

## 主要实现位置

- `components/workspace/ChangeList.tsx`
- `components/workspace/ReviewPanel.tsx`
- `components/workspace/WorkspacePanel.module.css`
- `lib/review-progressive.ts`
- `scripts/check-performance-budgets.mjs`
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`
