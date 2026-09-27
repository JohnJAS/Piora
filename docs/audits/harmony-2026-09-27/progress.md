# 鸿蒙重构实施与验收记录

范围：用户要求的 H00–H22 全部功能，并包含已有本地修改的提交、GitHub 推送及新 beta 工作流。附件历史结论用于逐项复核，不作为已经复现的证据。投屏不得自动开屏或解锁是本次明确要求。

初始 checkout 为 `7f950862`，先保存并恢复用户修改、同步 `53544c6d`，随后再次保存修改并同步 `103519bb`（Windows 截图与聊天草稿附件）。两次 CHANGELOG 冲突均保留远端和本地内容。原始清单见 [inventory.json](inventory.json)；清理决定见 [manifest](../repository-cleanup-manifest.json)。

## 实施映射

下表的“已实施”指代码路径存在并进入软件回归，不表示所有机型已经通过物理验收。核心 lease/queue 仍由 Manager 统一持有；按职责提取契约、观察、输入、音频、worker、策略、记录和诊断模块，避免为改目录而复制控制状态。

| 任务 | 实施结果 | 主要证据或边界 |
| --- | --- | --- |
| H00 | 基线、已有修改与引用清单已记录 | inventory.json；两次 fetch/快进/恢复；无用户修改丢弃 |
| H01 | 共用可控双设备与故障注入 fixture | controlled-backend、authorized-manager；延迟、取消、失效观察、worker 和媒体回归 |
| H02 | 观察质量、引用 TTL、唯一身份重定位、负向断言保护 | harmony-observation-safety；空树/部分树/重复/过期时写入次数为 0 |
| H03 | device/lease epoch、逐设备 lane、主动 TTL、派发栅栏、有界停止、恢复日志 | harmony-lease-lifecycle；撤销和过期中止对应设备，其他设备继续 |
| H04 | 原生显示与帧几何、rotation/crop/letterbox 转换、帧期限、前端断线失效 | harmony-geometry、harmony-video-metadata、HarmonyPanel 浏览器点击回归；实机分辨率组合未验证 |
| H05 | 28 项统一动作目录、协议版本、discriminated schema、HTTP/场景/Agent 校验和文档生成 | harmony-action-contracts；harmony:docs:check |
| H06 | 任务应用授权、一次性危险操作批准、HAP 哈希/私有副本、限时消费 | harmony-policy；审批绑定 run/lease/device/参数；普通测试输入不逐次弹窗 |
| H07 | 只读 doctor、HDC/UiTest/uinput/服务/树/音频路线、版本与缓存、失败降级及显式重探测 | harmony-capabilities、harmony-runtime-contracts；声明、探测、物理验证分开 |
| H08 | 精确 set/append/clear 回读、真实 idle 策略、累计 60 次搜索滚动预算、失败收据 | harmony-scenario-executor、harmony-runtime-contracts；效果未知不重放 |
| H09 | 独立 Hypium 子进程、版本/epoch/设备/截止时间 IPC、取消终止、本机设备仲裁、保留遥测配置其他字段 | harmony-worker、harmony-hybrid-backend；父进程 PATH 不变；任意脚本/过期 IPC 被拒绝 |
| H10 | 实体 power/volume 符号键、有界 down/interval/up、精确时长校准、助手后置条件 | harmony-input-hold；真实电源/音量行为须在目标手机确认 |
| H11 | 连续 touch hold、输入校准、焦点/几何监控、释放状态和不确定清理隔离 | harmony-input-hold、harmony-voice-input；未向未连接设备发送动作 |
| H12 | 有界不可变 PCM16 WAV、内容 hash、明确 Windows 输出、预览、房间级互斥、取消清理 | harmony-audio-assets；本机输出设备枚举成功；未播放测试语料 |
| H13 | 点击监听及 push-to-talk 复合动作、就绪与尾静音预算、手机精确转写后置条件 | harmony-voice-input；播放完成不能代替识音通过；真实 ASR 未验证 |
| H14 | 独立 production/debug App 工程、真实麦克风源、debug-only 单次 PCM 桥及生产 HAP 扫描 | harmony-app-test；两工程实际 DevEco ArkTS/lint 均通过；未签名打包/安装 |
| H15 | 轻量网关、动作发现、capabilities、应用名称/启动入口、过滤/区域/祖先分页、语音入口 | harmony-agent-extension-integration、harmony-applications、工具容量回归 |
| H16 | 工作台诊断、应用、输入、语音、场景和记录；审批、初始化、单设备接管与恢复 | HarmonyPanel 浏览器回归；既有面板 Props、日志与代码检查保留 |
| H17 | 私有输入与公开结果分离、持久执行收据、running/not-run、检查点重观测恢复、六份共享模板 | harmony-execution-store、harmony-templates；设备/流程/HAP 内容变化拒绝恢复 |
| H18 | 自有 H.264→MP4 录制、按设备日志中止、私有制品配额、支持包脱敏、fport 所有权和崩溃记录 | harmony-owned-recording 使用真实编码帧验证 MP4；不再切换全局录屏；无法确认的旧端口仅提示人工核验 |
| H19 | 现有 DevEco CLI → 源指纹/HAP hash → 批准安装 → 场景 → 目标进程日志；保存最近 20 份工程报告 | harmony-development-chain；制品与源码关联标为用户选择，不伪称构建出处或 IDE Problems |
| H20 | 清理 manifest、归档三份根性能文档、保留品牌/官网/发布输入和必要后端 | repository-cleanup-manifest；无无证据批量删除；归档保留历史正文 |
| H21 | 根 README、中文跳转页、文档索引、当前设备指南、历史说明和生成门禁统一 | 14 个当前文档入口本地链接验证；无重复中文版本号 |
| H22 | 软件/可选真机 CI、worker 编译与打包探针、beta 元数据及许可证准备 | 最终全量测试与 GitHub Actions 状态见下方；真机门禁不伪报通过 |

## F01–F13 复核

F01/F05 在初始代码仍有旧引用坐标兜底和无效空观察断言路径，已由质量与唯一匹配回归替换。F02 几何缺口由服务端映射及浏览器验证覆盖，设备差异仍需实测。F03/F13 的审批元数据未控制真实派发，现统一策略，并把安装/启动服务从被动订阅分离。F04 的撤销/停止分支现共用派发栅栏和有界资源回收。F06/F07 扩充动作能力、实体键、触摸和声学链路，未知设备不声称支持。F08 固定等待与驱动 idle 分开记录，文本不再以点击插入伪装精确设置。F09 在子进程设置 HDC 环境，全局 Hypium 配置加锁并只更新 telemetry。F10 新增跨进程实测互斥。F11 已统一现行文档并保留历史。F12 三个后端各有职责，保留实现并提取共享边界，不按名称删除。

## 验证记录

- 首轮完整测试：2,192 项，2,179 通过、8 失败、5 跳过。失败已定位：旧几何/录屏测试假设、VM mock、CI fixture 检查、会话目录索引测试接口以及 Windows UIA 大 JSON 截断；修正后对应回归通过。
- 最终 Harmony 专项回归：189/189 通过。针对性资源与开发链回归：14/14 通过；版本化 worker 协议回归：5/5 通过。
- ASAR sidecar、worker、Shell、原生 PTY 与图像依赖回归：10/10 通过。音频 PowerShell、编译后的 worker 与 Hypium 设备资源明确解包到真实文件目录，包后检查验证实际文件和 MPL 源码存在。
- 根项目与桌面类型检查通过；lint 0 错误，保留两条既有脚本警告。
- performance budgets、14 个文档入口、28 动作/6 模板生成一致性、release-tree hygiene 通过。许可证清单按锁文件生成，共 1,373 个独立依赖项；生产依赖 audit 为 0 个漏洞。
- DevEco Studio 26.0.0.461 / CLI 1.3.3：新生成 production 工程 ArkTS/lint 通过，debug 工程 ArkTS/lint 通过，诊断均为 0。软件检查不代表 HAP 安装或生产制品扫描已完成。
- 本机没有已连接授权的 Harmony 设备；真实设备脚本输出 blocked，scenarios=0，hardwareVerified=false。不同原生/视频分辨率、横竖屏、实体键、真实麦克风/ASR、断连和双品牌并发硬件验收为 not-run。
- 最终全量测试完成：2,212 项，2,207 通过、0 失败、5 跳过（约 19 分 13 秒）。全量运行枚举之后新增的 ASAR fixture 另行通过上述专项回归。
- beta 版本为 `0.5.2-beta.10` / 2026-09-28。本记录随发布提交保存本地验证结果；提交、标签和构建/发布结果以 GitHub 对应 SHA 的 Actions 状态为准，不能把推送标签视为发布完成。

详细日志位于本地忽略目录 `.verification/harmony-refactor/`，不提交运行环境路径、录音或设备截图。安装包仅由 GitHub Actions 构建，本地未运行 Next release build 或发布打包。Mediabunny 使用未改动的固定版本，发布包附带 MPL 许可证与原始源码。

## GitHub Windows 路径回归修复

`32d81ce8` 和 `v0.5.2-beta.10` 已推送。Linux 三个分片通过；Windows 云端发现 6 项制品路径测试失败，本地原全量结果仍为上述 2,207 通过。问题为 `realpath` 字符串比较把 Windows 大小写/8.3 别名判为重定向。现统一逐层检查目录项，保留符号链接/junction 拒绝和有界文件读取，新增真实 NTFS 别名及重定向回归。beta.10 的测试门禁阻止发布；修复使用新版本 `0.5.2-beta.11`，不移动已有标签。

修复后本地路径/制品专项 22/22、Harmony 专项 191/191、类型检查及文档/卫生门禁通过。云端 beta.10 包后验证还发现 Next 仅跟踪媒体库 ESM 入口，缺少源加载扩展所需的 CommonJS 入口；已完整暂存媒体库依赖闭包，独立媒体入口与打包回归 10/10 通过。beta.11 的云端测试与实际包后结果以对应 Actions 为准。
