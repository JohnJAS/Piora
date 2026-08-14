# Piora Stage 4 · Batch 7 验收记录

日期：2026-08-09

## 本批范围

- 删除左侧重复的“活动”区域，任务状态继续由项目会话行承担。
- 设置页收口为“通用 / Agent / 扩展 / 外观”四个一级分类，语言、模型、技能、插件和宠物改为分类内二级页面。
- 桌面菜单删除重复的“功能”菜单，只保留一个“设置”入口；宠物窗口显示开关归入“视图”。
- 右侧工作区删除独立“搜索”页签，文件查找统一进入“文件”页签的筛选框。
- 命令输入框压缩到 30px，并使用低对比度中性聚焦态；运行按钮使用紧凑主操作样式。
- 审阅视图移除单独占行的复制工具栏，压缩文件列表和 Diff 块头，统一刷新、暂存、撤销、运行和提交操作的视觉层级。

## 审阅视图细节

- 文件行由双行 42px 改为单行 32px，根目录不重复显示，只保留必要的末级目录。
- 文件路径、状态、打开文件和复制差异合并到一个 34px 标题栏。
- Diff 块头固定为 28px 单行，仅显示 `@@ -x,y +x,y @@`；完整上下文保留在普通悬浮提示中。
- 刷新按钮为 28px 图标按钮；点击刷新后的焦点态使用轻量中性底色，不再出现持续蓝色粗框。
- 暂存与撤销作为低干扰次级操作，运行与提交作为紧凑主操作。

## 自动化验证

- `npm run typecheck`：Web 与 Desktop TypeScript 检查通过。
- `npm run lint`：通过。
- `npm test`：537 项，532 通过，0 失败，5 项按环境条件跳过。
- `npm run perf:check`：全部性能预算通过。
- `git diff --check`：本批文件无空白错误。
- 未运行 `next build`。

## 浏览器验收

在 `http://127.0.0.1:30141` 使用真实的 239 项 Git 变更验证：

1. 左侧无“活动”区；设置入口、右侧页签和文件查找入口均无重复。
2. 审阅文件列表为紧凑单行，根路径不重复占位。
3. `CONTRIBUTING.md` 的长 Diff 上下文不会撑高块头。
4. 连续点击刷新后，紧凑布局和块头格式保持不变。
5. 刷新按钮点击后不再出现蓝色粗焦点框。
6. 命令输入框、聚焦态和运行按钮均保持紧凑。
7. 未执行暂存、撤销、提交或任何 Git 写操作。

## 主要实现位置

- `components/SettingsDialog.tsx`
- `components/SettingsDialog.module.css`
- `components/AppShell.tsx`
- `components/SessionSidebar.tsx`
- `components/sidebar/SidebarNavigation.tsx`
- `components/workspace/RightPanel.tsx`
- `components/workspace/ReviewPanel.tsx`
- `components/workspace/ChangeList.tsx`
- `components/workspace/CommandPanel.tsx`
- `components/workspace/WorkspacePanel.module.css`
- `components/DiffView.tsx`
- `components/DiffView.module.css`
- `desktop/src/main.ts`
- `desktop/src/preload.ts`
- `lib/commands.ts`
