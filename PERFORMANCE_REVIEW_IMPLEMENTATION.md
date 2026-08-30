# Piora 性能 Review：本轮取舍与落地记录

本文对照基于 `a4b833d` 的性能 Review，记录当前工作区这一轮实际采用的修改、仍需单独设计的改造，以及不应按字面直接实施的建议。目标是让后续性能工作可以按证据推进，而不是把架构方向一次性塞进高风险补丁。

## 结论

Review 对核心问题的判断合理：大 Session 的全量同步解析、重复终态加载、无意触发的预取，以及流式期间的全局状态重算会相互放大。本轮优先消除了不依赖 Session 协议重构的重复工作，并为后续分页和索引保留兼容路径。

本轮没有声称“首屏成本已经与历史长度脱钩”。当前默认请求虽然不再构建 tree，并延迟 Thinking 与工具结果图片，但仍会完整解析活动 Session 并返回完整活动分支。真正解决这一点仍需要 bootstrap/history 协议和 Entry Index。

## 建议分类

| Review 建议 | 判断 | 本轮状态 | 依据或原因 |
| --- | --- | --- | --- |
| 悬停 200ms 后预取、离开取消、最多一个请求 | 合理，可立即改 | 已完成 | `components/sidebar/TaskRow.tsx`、`lib/session-prefetch.ts` |
| 前端预取缓存按字节控制 | 合理，可立即改 | 已完成 | 16 MiB 总预算；缓存序列化响应解析后的对象大小估算，不再按固定 Session 数量淘汰 |
| pointerdown 复用悬停请求 | 合理，可立即改 | 已完成 | 同一 Session 请求被提升为不可因 mouseleave 取消，不创建第二个请求 |
| `agent_end` 不再全量重载 | 合理，可立即改 | 已完成 | `hooks/useAgentSession.ts` 只在统一终态结算中加载一次 |
| 同一 runId 终态对账 singleflight | 合理，可立即改 | 已完成 | 结算和 idle 轮询均按 runId 合并 |
| 首屏默认不构建 tree | 合理，可立即改 | 已完成 | `/api/sessions/[id]` 仅在 `includeTree` 存在时构建 tree |
| 首屏只返回最后 20～40 回合 | 方向合理，需要协议前置 | 未直接实施 | 没有 history/cursor 接口时截断会让旧历史无法访问，并破坏 fork、分支导航和 entryId 对齐 |
| Session 请求 AbortController | 合理，可立即改 | 客户端已完成 | 快速切换会中止旧 fetch；同步服务端解析仍不能被该信号抢占 |
| 流式运行快照节流 | 合理，可立即改 | 已完成 | 普通流式事件 250ms 节流，生命周期、审批、压缩等状态立即推送 |
| Wrapper 缓存 Session title | 合理，可立即改 | 已完成 | snapshot 不再为标题反复复制完整 entries；重命名路径同步更新缓存 |
| Session 完成后不全量刷新侧边栏 | 合理，可立即改 | 已完成 | 本地只更新目标 Session 的 `modified`，不再请求完整 `/api/sessions` |
| 单一全局运行状态源 | 合理，可立即改 | 已完成 | `useTaskStatus` 提供共享 SSE store；仅断线时轮询；支持按 sessionId 订阅 |
| 服务端缓存序列化响应、字节预算、ETag | 合理，可立即改 | 已完成 | 48 MiB LRU 字节预算；缓存 `JSON.stringify` 结果；支持 `If-None-Match`/304 |
| 避免重复构建 SDK context | 合理，可立即改 | 已完成 | Piora 不再构建并丢弃 `piBuildSessionContext().messages`；settings 从活动祖先链解析，压缩条目仍由 SDK 选择 |
| 持久化 Session Catalog | 合理，属于独立数据迁移 | 后续阶段 | 需要原子更新、增量 append、整文件重写、删除、恢复和损坏文件恢复语义 |
| bootstrap/history/tree/delta 接口 | 合理，属于协议改造 | 后续阶段 | 必须与前端窗口状态、fork/navigation、缓存版本和恢复策略一起设计 |
| Entry byte-offset index | 合理，是规模化基础 | 后续阶段 | 可统一支持分页、单 Entry、delta、tree、Thinking 和 Prompt Material；需要处理 UTF-8 边界与整文件重写 |
| Worker Parser Pool | 合理，依赖纯解析边界 | 后续阶段 | 应传递文件路径、偏移和纯数据；不能跨线程共享 `SessionManager` 或可变 AgentSession 对象 |
| 真正虚拟列表、时间轴降采样、增量统计 | 合理，依赖分页模型 | 后续阶段 | 在前端仍持有完整消息时只做虚拟化，无法消除网络、解析和大部分 O(n) 派生成本 |
| AgentSession 不可变资源共享 | 合理，但风险高 | 后续专项 | 先拆出不可变 settings/model/extension metadata；ExtensionRuntime、UI context、SessionManager 等仍须 Session 私有 |
| 真实 JSONL / 浏览器 / 事件循环基准 | 合理 | 部分完成 | 当前补充了行为回归与性能结构测试；真实大文件、E2E 和 event-loop 指标仍需专门基准夹具 |

## 不应按字面直接修改的项目

以下建议方向没有问题，但直接照搬会造成正确性或恢复能力倒退：

1. **不能只把 AgentSession service cache key 从 sessionId 改成 cwd。** ResourceLoader 内含可变 ExtensionRuntime，跨 Session 共享可能导致扩展消息和 UI 上下文串线。必须先拆不可变层和 Session 私有层。
2. **不能在没有 history 接口时直接截断当前响应。** 这会让旧消息、目标 entryId 和分支操作不可达。正确顺序是先定义 cursor/version，再切换 bootstrap 默认行为。
3. **不能彻底删除运行状态轮询。** SSE 是主通道，但断网、系统休眠和半开连接需要低频轮询做恢复；本轮只删除了与健康 SSE 并行的固定轮询。
4. **不能假设 AbortController 会中断同步 `SessionManager.open()` 或 `JSON.parse()`。** 它现在能停止旧客户端响应消费；服务端取消必须等解析迁入可分块检查取消标记的 Worker 任务。
5. **不能把可变 `SessionManager` 直接放进 Worker 池复用。** Worker 层应负责纯文件解析、索引和投影，AgentSession 生命周期仍由当前 wrapper 管理。
6. **不能先引入虚拟列表再把它当作分页替代品。** 虚拟列表减少 DOM，但完整响应、JSON.parse、消息派生和统计扫描仍然存在。
7. **不能直接修改 `node_modules` 中的 SDK context 实现。** 本轮用本地适配移除一次无用构建；最终的一次遍历 API 应在 SDK 正式导出后切换。

## 本轮行为边界

- `/api/sessions/[id]` 的 JSON 字段保持兼容；默认 `tree` 为空数组，调用方需要分支树时显式传 `includeTree`。
- 轻量投影才进入服务端缓存；包含完整 Thinking 或媒体的响应不占用该缓存。
- ETag 由 Session 文件 `size + mtimeMs` 和投影参数派生，响应使用 `Cache-Control: private, no-cache`，允许浏览器复用但每次重验证。
- 缓存保存已经序列化的字符串，命中时不再重复 `JSON.stringify`。超过 48 MiB 时按最近访问时间淘汰；单条超预算响应会正常返回但不会长期驻留。
- `agent_end` 仍负责清理临时 UI 状态；`prompt_done + idle` 是唯一的完整终态结算入口。
- SSE 正常时不轮询；SSE 不可用时保留恢复轮询。

## 后续实施顺序

### 阶段 2：让首屏与总历史长度脱钩

1. 定义 `fileVersion`、`beforeCursor` 和稳定的展示单元边界。
2. 增加 bootstrap/history/tree API，并为旧 `/api/sessions/[id]` 保留过渡兼容层。
3. 前端只维护当前历史窗口；上滚时保持 scroll anchor。
4. 把统计初始值放入 bootstrap，新消息通过 reducer 增量更新。
5. 使用动态高度虚拟列表；时间轴限制可见节点并保留当前回合、分支点和标记点。

该阶段必须验证 fork、navigate_tree、压缩摘要、延迟 Thinking/媒体和快速切换行为。

### 阶段 3：消除主进程全量同步解析

1. 建立可恢复的 Session Catalog v1，并覆盖 append、truncate/rewrite、delete/trash/restore。
2. 在同一次扫描中建立 Entry Offset Index，不再单独扫描 Goal 文件尾部。
3. Thinking、Prompt Material 和单 Entry 路由改为定点读取。
4. 增加 delta API，并将终态结算从完整加载切换为 delta。
5. 将纯解析、投影和序列化迁入有并发上限的 Worker 池。
6. 最后拆分 AgentSession 不可变启动资源与 Session 私有 runtime。

## 验证要求

本轮最低回归门槛：

```text
npm run typecheck
npm run lint
npm test
npm run perf:check
git diff --check
```

后续分页/索引阶段还必须增加：

- 1k、10k、50k entries 和 10/50/100 MiB JSONL 的 cold/warm 基准；
- hover 连续经过 20 个 Session 时最多一个在途请求；
- A → B → C 快速切换时 A/B 被取消且不能覆盖 C；
- 多个 `agent_end` 只产生一次终态结算；
- 50k entries 首屏创建的 render unit 数量受窗口上限约束；
- 解析期间的 event-loop delay、响应字节数、cache hit/miss 和 Worker queue wait；
- 埋点只记录尺寸、数量和耗时，不记录消息正文。
