# Subagent 实现与验收计划

需求：[issue #436](https://github.com/kexijiang/pi-desktop/issues/436)。调查起始日期：2026-11-16。

## zCODE 安装版的证据

对象为 `G:\software\ZCode` 3.16.3.8992；REA 6.8.0 只对安装产物做静态解析，没有执行 zCODE 的运行时。
证据存于本机 Codex 可视化产物目录的 `2026/11/16/01a1e511-55d4-72c1-b8f6-d8b38c7d7341` 子目录（未提交到仓库）：
`rea-subagent-evidence`、`rea-subagent-runtime-evidence`、两个 `*-result.json`，以及 `rea-subagent/` 中带源位置的提取片段。

ASAR 中 `subagentsStore-BF3iXtI0.js` 提供类型启用/禁用和配置管理。`glm/zcode.cjs` 的 Agent 参数定义从字符偏移 1445264 起；处理入口从 7776603 起；launch/run 从 12778516 起。静态证据显示：

- `Agent({description,prompt,subagent_type?,run_in_background?})`，缺省为 `general-purpose`，另一内置类型为 `Explore`。
- 每次 Agent 创建独立 agentId、childSessionId、子轨迹及结果文件；只向父代理返回最终结论和 usage。
- 类型配置提供 systemPrompt、tools/disallowedTools、modelSelection、maxTurns、background；父可用工具约束子工具。
- 前台等待返回；后台立即返回并在完成后发送通知；SendMessage 可继续既有子代理上下文。
- 状态包含运行、成功、失败、取消；统计包含 token、工具次数与耗时；父取消和空闲超时沿 child signal 传播。
- 界面/运行时配置具有 disabledAgentIds、内置与插件模型覆盖。

REA 的两次解析均无语法失败；第一份图有语义数量上限和未选择模块，属于 partial。片段分析的外部依赖仍未知。以上不代表 zCODE 实机行为已验收，也不承诺所有内部路径已经恢复。Piora 对齐可观察接口与行为，使用自己的 SDK 和存储实现。

## 实现

1. 设置 → 实验室提供子代理总开关、类型开关和模型覆盖。总开关默认关闭，配置保存到 Agent 数据目录。读取旧配置时忽略已移除的运行限制字段。
2. 注册 Agent、SendMessage、TaskOutput、TaskStop，启用后才向模型声明。独立 SDK 子会话只接收任务；Explore 仅允许结构化读取/搜索，通用和自定义类型取父工具集交集。禁止递归委派。
3. 复用现有会话生命周期、模型范围、工具审批及取消处理。子工具审批显示在父对话中，使用父权限和授权；后台权限同样生效。关闭总开关停止运行中的子代理，保留历史。
4. 子会话与结果持久化，普通侧栏不混入临时子会话；父对话可展开查看执行内容、耗时、token 和错误。重启把未完成任务标成 interrupted，禁止自动重复副作用；已完成的子会话可通过 SendMessage 继续。
5. 每个对话支持同时执行四个子代理。子代理累计记录模型用量，沿用会话的模型请求超时和停止机制。返回给父模型的摘要有长度上限，执行记录单独保存。

## 查看执行记录

父聊天有子代理正在运行时，侧栏显示默认收起的「子代理」组和运行数。任务结束后，可从聊天中该任务的「查看详情」打开历史。详情优先显示状态、结果和结束原因，展开执行记录后可逐项查看任务说明、回复和工具活动，较长记录按页读取。桌面端可拖动详情左边缘并记住宽度，窄屏采用弹层。关闭面板后任务继续运行。「停止此子代理」取消当前尝试，主聊天的停止操作控制整个父任务。

## 验证与发布

- 快速测试覆盖旧配置兼容、类型解析、权限交集、上下文隔离、并发、结果摘要、失败、取消、重启恢复和继续消息。回归用例确认累计用量跨过旧预算、探索超过二十轮和执行超过五分钟后仍可继续。
- 确定性模型夹具贯穿真实 UI/SDK：设置开关和刷新、并行、后台通知、展开过程、取消、权限和恢复。夹具结果不能写成真实模型通过。
- 真实模型：在隔离工作区运行搜索/写入/验证的独立子任务，核对实际工具、文件与汇总结论，记录模型和 usage。
- 只通过 GitHub Actions 构建 Windows x64 NSIS beta，检查 CI、标签、提交、release notes、校验和及自动更新元数据。下载 GitHub 的安装包，安装后重复关键 UI/模型/异常用例；记录失败和复测。未执行的平台不记通过。

自定义类型放在 `<agentDir>/agents/*.md` 或项目 `.piora/agents/*.md`。示例：

```markdown
---
name: reviewer
description: Review the assigned files and return concrete findings.
tools: read, grep, find, ls
model: provider/modelId
background: false
---
Review only the assigned scope. Return evidence and unresolved risks.
```

模型字段可省略以继承父会话；设置中的类型模型覆盖优先。项目同名配置覆盖用户配置，内置类型不能被重定义。
桌面验证入口支持 `--scenario subagents`；`--executable <安装后的 Piora.exe>` 使用隔离配置启动安装包并复用同一场景。
