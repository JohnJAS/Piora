# 对话内容右键菜单验证

日期：2026-11-17。基线：`3ce3748914fb6ea6e91ecca13cf2cdb37c0df7a0`。实现位于 `chat-context-menu-20261117` 独立工作树，未修改原工作树中尚未提交的运行状态文案功能。

## 变化与范围

- 对话中的本地文件链接、工具文件项和文件变更路径提供复制路径、复制显示文字和资源管理器定位；目录通过同一桌面接口打开。
- 普通网页链接提供复制地址和文字，选中文字提供独立的复制操作。嵌套代码标签仍使用实际链接目标；文件路径的行列号不传给资源管理器。
- 复用现有桌面剪贴板与 `revealPath` 接口，没有增加服务端文件权限或系统执行接口。浏览器模式保留复制，并禁用原生文件定位。
- 菜单支持 Shift+F10、方向键、Home/End 和 Esc，限制在视口内；编辑输入框保留原生菜单，左键打开行为不变。复制失败或文件不可访问时显示提示。

## 快速验证

前期浏览器和既有单元测试复用原工作树的依赖；独立安装锁文件依赖后，重新完成类型检查、定向 ESLint 和真实桌面复测。

- `node --test lib/chat-context-menu-browser.test.mjs components/MessageView.test.mjs components/MarkdownBody.test.mjs lib/file-references.test.mjs`：首次混合运行 45 项通过、1 项失败。新浏览器用例遗漏了 assistant 样式标记，未生成文件链接；已修正夹具并单独复测通过，未降低断言。
- `node --test lib/chat-context-menu-browser.test.mjs`：通过。覆盖中文/空格路径、行列号、file URL、代码标签中的链接、相对路径、工具文件和目录、选中文字、键盘、点击外部关闭、窄视口、失败与重试、无桌面桥的复制和左键打开。
- `node --test lib/file-links.test.mjs lib/file-tool-result.test.mjs lib/i18n/registry.test.mjs`：16 项通过。
- `node_modules/.bin/tsc --noEmit --incremental false`：通过。
- 本次组件、测试和桌面场景的定向 ESLint：通过。
- `node scripts/changelog-fragments.mjs check` 与 `git diff --check`：通过。

## 桌面测试记录

- `.verification/desktop-e2e-56n3H4`：启动失败。共享依赖中的 Electron 自动安装未完成，主动停止本轮安装子进程；未进入功能步骤。
- `.verification/desktop-e2e-4fwPan`：启动失败。Turbopack 无法从限定的工作树根读取目录外的 node_modules 链接；停止本轮拥有的开发进程树后，运行器清理完成。
- `.verification/desktop-e2e-bqaGUx`：`open-synthetic-chat` 失败。首次会话接口冷编译请求耗时 30.2 秒，超出已有 UI 的 30 秒加载期限；接口后续读取返回 200，但本轮未进入菜单测试。新场景加入只读会话准备以避开该开发冷启动条件，保留全部菜单断言。
- `.verification/desktop-e2e-t7WNaK`：`open-synthetic-chat` 失败。会话读回成功，但 Turbopack 报告 `MarkdownBody.tsx` 的 lazy compilation proxy 被 HMR 删除，界面停留在原始文本占位，120 秒内未出现链接。场景调整为准备会话并通过 UI 选中后刷新一次，再验证菜单；不代表开发冷启动 Markdown 加载已修复。
- 后续运行改为工作树内的锁文件依赖（`npm ci --ignore-scripts` 并执行仓库依赖补丁），Next.js 为 16.4.6。使用经过本地官方 checksums.json 核对的缓存 Electron 45.2.3 运行开发测试；它不是锁文件声明的 Electron 45.3.1，也不是已发布安装包。
- `.verification/desktop-e2e-IZIylQ`：**通过**。从工作树根目录执行命令 `node scripts/run-desktop-e2e.mjs --scenario chat-context-menu --electron-dist .verification/electron-45.2.3 --step-timeout-ms 180000 --timeout-ms 900000`。全部 8 个步骤通过，无未捕获页面异常、无运行器清理错误。
- 本轮通过真实 UI 右键复制后读取系统剪贴板，得到去掉行列号的完整文件路径；复制网页链接保留查询参数和片段。失效文件提示、键盘打开与关闭、刷新后的复制也通过。
- 原生资源管理器观察到测试目录，并确认 `报告.md` 是选中文件；随后通过目录路径菜单打开目录。证据：`.verification/desktop-e2e-IZIylQ/chat-context-menu-evidence.json`；菜单与错误提示截图分别为该目录下 `file-context-menu.png`、`missing-file-feedback.png`。

浏览器用例中的桌面桥为夹具；真实桌面结果以各轮 `result.json` 与 `chat-context-menu-evidence.json` 为准。未运行完整 CI、真实模型、发布安装包或其他操作系统验收，未构建发布包。
