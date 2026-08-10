# Piora Stage 4 · Batch 8 验收记录

日期：2026-08-09

## 本批范围

- 文件标签支持原生拖拽排序，排序只改变标签顺序，不重建文件查看器或丢失活动标签。
- 标签右键菜单与 `Shift+F10` 共用同一操作面板，支持向左/向右移动、关闭当前、关闭其他、关闭右侧和恢复最近关闭。
- 关闭历史最多保留 12 项，自动去重；恢复时重新从磁盘加载，不伪造已丢弃的未保存状态。
- `Ctrl/Cmd+Shift+T` 可恢复最近关闭的文件；即使关闭最后一个标签后右栏收起，快捷键仍可重新打开右栏和文件页签。
- 单个与批量关闭统一经过未保存变更确认；取消确认会保留标签和编辑内容。
- 菜单支持方向键、`Home`、`End` 和 `Escape`，操作后焦点恢复到原标签；若原标签已关闭则回到标签操作按钮。
- 新增完整中英文标签操作与未保存确认文案。

## 实现约束

- 标签顺序、批量选择和关闭历史逻辑位于 `lib/file-tabs.ts`，使用无副作用纯函数并独立测试。
- `AppShell` 仍是打开标签、活动标签和关闭历史的唯一状态源；没有在 `TabBar` 或 `RightPanel` 中复制业务状态。
- 关闭历史只保存标签元数据，不保存编辑器正文，不把已放弃的未保存内容误标为可恢复。
- 本批未改变文件保存 API、允许目录边界或 Git 写操作。

## 自动化验证

- 针对性回归：17 项通过，0 失败。
- `npm test`：544 项，539 通过，0 失败，5 项因当前 Windows 账户不允许创建符号链接而跳过。
- `npm run typecheck`：Web 与 Desktop TypeScript 检查通过。
- `npm run lint`：通过。
- `npm run perf:check`：全部性能预算通过。
- `git diff --check`：通过。
- 未运行 `next build`。

## 浏览器验收

在 `http://127.0.0.1:30141` 的中文界面使用 `package.json`、`README.md` 和 `LICENSE` 验证：

1. 三个文件以独立标签打开，活动标签和关闭按钮语义正确。
2. `Shift+F10` 打开“文件标签操作”菜单，禁用项随标签位置正确变化。
3. “向左移动标签”把 `LICENSE` 从第三位移动到第二位，操作后焦点仍在 `LICENSE` 标签。
4. “关闭右侧标签”只关闭 `README.md`；按 `Ctrl+Shift+T` 后按原文件元数据恢复到标签末尾并成为活动标签。
5. 编辑器产生未保存状态后，关闭标签会出现确认提示，不会静默丢弃内容。
6. 页面无 Next.js 错误覆盖层；验收未保存文件，也未执行暂存、撤销、提交或其他 Git 写操作。

## 主要实现位置

- `components/TabBar.tsx`
- `components/TabBar.module.css`
- `components/AppShell.tsx`
- `components/workspace/RightPanel.tsx`
- `lib/file-tabs.ts`
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`
