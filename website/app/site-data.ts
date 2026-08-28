export const githubUrl = 'https://github.com/kexijiang/Piora';
export const latestReleaseUrl = `${githubUrl}/releases/latest`;

export const heroStats = [
  { value: '12', label: '大能力域' },
  { value: '20', label: '张原创背景' },
  { value: '4', label: '种发行格式' },
  { value: '0', label: '默认遥测' },
  { value: 'MIT', label: '完全开源' },
] as const;

export const coreFeatures = [
  {
    icon: '🤖',
    tint: 'tint-blue',
    title: 'AI 会话与任务执行',
    summary: '从一句话需求到可验证的交付，过程全部留在同一条时间线上。',
    items: ['流式对话、代码高亮、Mermaid 图表与工具结果展示', '普通 / 计划 / 目标三种模式，按任务难度自由切换', '任务运行中可随时引导（Steer）或排队（Queue）', '上下文用量可视，自动压缩不丢关键信息'],
  },
  {
    icon: '📂',
    tint: 'tint-cyan',
    title: '文件与代码工作区',
    summary: '聊天旁边就是项目本身，浏览、编辑、预览、比较一站搞定。',
    items: ['Source / Edit / Preview / Diff 四种视图随心切换', '跨标签保留草稿，外部修改自动感知、冲突不覆盖', '图片、音频、PDF、DOCX 与 Markdown 直接预览', 'SHA-256 版本校验、文件锁与原子替换，写得放心'],
  },
  {
    icon: '🌿',
    tint: 'tint-green',
    title: 'Git、审阅与 Worktree',
    summary: '让 AI 的每一处改动可见、可查、可回退，直到你点头提交。',
    items: ['状态、Diff、增删行统计一目了然', '暂存、提交、推送与恢复全程在应用内完成', '为并行任务创建、切换、移除 Git worktree', '改动卡片 + Review 面板，审阅闭环'],
  },
  {
    icon: '🌐',
    tint: 'tint-orange',
    title: '内置浏览器',
    summary: '查资料、开页面、截图下载，都留在任务上下文里。',
    items: ['桌面版内置独立浏览器工作区与第一方工具', '多标签、导航、刷新、网页截图与下载', '支持 Chrome 书签层级导入', '兼容会话自动发现，无需切换运行模式'],
  },
  {
    icon: '👥',
    tint: 'tint-violet',
    title: '多智能体房间与团队',
    summary: '规划者、执行者、审查者在同一个协作空间里并肩工作。',
    items: ['Room 保存团队身份、任务、审计与产物索引', '依赖感知调度、并发上限与有界重试', '独立审查、证据追踪与审批流程', '跨项目选择 Session，@ 提及直达成员'],
  },
  {
    icon: '📱',
    tint: 'tint-pink',
    title: 'HarmonyOS NEXT 真机自动化',
    summary: '把已授权的华为测试机带进工作区，人机能同屏协作。',
    items: ['自动发现 HDC，USB 设备即插即用', '约 1 FPS 本地投屏，点击、滑动、输入、启动应用', '每次 AI 取得控制权都需用户确认，支持一键急停', '可选独立视觉模型，原始截图默认不出本机'],
  },
] as const;

export const showcaseThemes = {
  tag: '主题与背景',
  title: '一套工作台，二十种心情。',
  text: '20 张原创背景全部随应用本地提供，覆盖极光、宣纸、星云、水彩、赛博等多种风格；也可以选择本机图片，独立调整侧栏与工作区的透明度、遮罩和模糊。',
  points: ['5 种配色主题：Light、Dark、Midnight、Forest、Dream Skin', '背景优先存 IndexedDB，绝不上传', '主题与背景不运行任何脚本代码'],
} as const;

export const showcaseHarmony = {
  tag: '真机自动化',
  title: '把测试真机，也交给 AI 打理。',
  text: '连接已授权的 HarmonyOS NEXT 设备后，投屏、UI 树、截图和设备日志都在右侧工作区。AI 按「观察—操作—验证」循环推进，每一步都有租约、陈旧画面校验和紧急停止兜底。',
  points: ['设备独占租约 + 全局串行队列，互不打架', '不支持绕过锁屏、验证码、支付等系统限制', '安装包不内置 SDK，使用你安装的官方 HDC'],
} as const;

export const featureGroups = [
  {
    id: 'agent',
    number: '01',
    title: 'AI 会话与任务执行',
    summary: '从一句话请求到可验证交付，运行状态、工具调用和中间结果都在同一条时间线上。',
    items: [
      '流式对话、Markdown / GFM、代码高亮、数学公式、Mermaid 图表与工具结果展示',
      '普通模式、持续执行的目标模式，以及只读分析后生成结构化方案的计划模式',
      '任务运行中可即时引导（Steer）或排队（Queue），并可随时停止',
      '计划草稿、明确审批、依赖顺序执行、步骤证据、验证覆盖和中断恢复',
      '模型可用原生卡片请求单选、多选或自由输入，答案写回对话历史',
      '上下文用量、自动压缩、命令面板、系统提示词与自动会话命名',
    ],
  },
  {
    id: 'workspace',
    number: '02',
    title: '文件与代码工作区',
    summary: '聊天旁边就是项目本身。浏览、编辑、预览和比较，不必在多个窗口间来回切换。',
    items: [
      '项目文件树、模糊搜索、标签页，以及 Source / Edit / Preview / Diff 四种视图',
      '行号、行列状态、Tab 缩进、快捷保存与跨标签草稿保留',
      '外部修改自动感知；有未保存草稿时提供继续编辑、重载或明确覆盖',
      '图片、音频、PDF、DOCX 与 Markdown 预览；聊天图片支持全屏查看',
      '基于 SHA-256 的版本校验、文件锁、原子替换、大小限制与路径安全校验',
      '改动卡片直接显示每个文件的增删行统计与可展开内联 Diff',
    ],
  },
  {
    id: 'git',
    number: '03',
    title: 'Git、审阅与 Worktree',
    summary: '让 Agent 的修改保持可见、可检查、可拆分，直到你决定提交。',
    items: [
      '查看仓库状态、文件 Diff 和增删行统计',
      '暂存、取消暂存、提交、推送与明确的文件恢复操作',
      '分支浏览，以及为并行任务创建、切换和移除 Git worktree',
      '右侧变更列表和 Review 面板，把对话、文件与审阅串成闭环',
      '脏 worktree 移除前二次确认；已删除工作区中的会话自动回归主项目分组',
    ],
  },
  {
    id: 'browser',
    number: '04',
    title: '内置浏览器',
    summary: '查资料、打开页面、截图和下载都留在任务上下文里。',
    items: [
      '桌面版内置独立浏览器工作区与第一方浏览器工具',
      '多标签、地址导航、前进后退、刷新、网页截图和下载',
      '书签栏、文件夹浏览，以及 Chrome 书签层级导入',
      '浏览器能力在兼容会话中自动发现，无需单独切换运行模式',
      '下载目录不可用时自动回退到应用自有目录，避免启动失败',
    ],
  },
  {
    id: 'harmony',
    number: '05',
    title: 'HarmonyOS NEXT 真机自动化',
    summary: '把已授权的华为测试设备带进右侧工作区，由人操作，也能交给 AI 完成受控流程。',
    items: [
      '自动发现 DevEco Studio、Command Line Tools、环境变量和 PATH 中的 HDC',
      'USB 设备发现、约 1 FPS 本地投屏、UI 树、截图和结构化设备日志',
      '点击、双击、长按、滑动、拖拽、输入文本、按键、启动应用与智能等待',
      '观察—操作—验证循环：每次状态变更后返回新的 UI 引用与语义变化',
      '可选独立视觉模型；原始截图跨模型转发默认关闭',
      '设备独占租约、全局串行队列、陈旧画面校验、敏感动作限制与紧急停止',
    ],
  },
  {
    id: 'teams',
    number: '06',
    title: '多智能体房间与 Agent Team',
    summary: '让规划者、执行者、审查者和协调者在一个持续存在的协作空间里工作。',
    items: [
      'Room 保存团队身份、职责、消息、共享任务、审计和产物索引',
      '稳定 Agent 身份可换绑 Session，并保留角色、私有目录与未完成任务',
      '依赖感知调度、并发上限、任务租约、有界重试、失败恢复与进度事件',
      '独立审查、证据与产物追踪、问题 / 审批流程和协调者最终汇总',
      '托管共享 workspace 或项目根目录内的自定义协作目录',
      '跨项目 Session 选择、@ 提及、消息导航和移动端抽屉式界面',
    ],
  },
  {
    id: 'sessions',
    number: '07',
    title: '会话、项目与远程控制',
    summary: '从随手聊到长期项目，再到外部程序接入，都使用同一套可靠的 Session 运行时。',
    items: [
      '项目会话与无需选择目录的 projectless Chat，按项目分组并支持快速搜索',
      '会话固定、重命名、自动命名、归档 / 恢复、复制、导出与可恢复删除',
      '独立 Fork 与会话内分支导航；深层历史按需加载并支持时间线定位',
      '刷新或网络恢复后自动重连流式任务，避免遗漏完成状态',
      '本机 HTTP / SSE API 支持创建会话、发消息、Steer、Abort、历史和工具发现',
      '能力令牌、Session 白名单、撤销、限流、幂等键和命令状态查询',
    ],
  },
  {
    id: 'models',
    number: '08',
    title: '模型、认证与视觉理解',
    summary: '连接你选择的模型提供商，精确控制当前会话能看到什么模型和能力。',
    items: [
      'API Key、OAuth / Device Code 登录、登出和提供商认证状态',
      '自定义模型、在线目录发现、连接测试、推理强度和模型范围筛选',
      '按模型显式配置图像输入能力，避免靠猜测路由图片',
      '文本模型可配置独立视觉 Agent，把图片转换为有界观察文本',
      '原图保留在本地会话；视觉观察有大小约束、缓存与无猜测回退',
      '自动标题、提示词优化和视觉 Agent 均可单独选择模型',
    ],
  },
  {
    id: 'ecosystem',
    number: '09',
    title: '扩展、Skills、Plugins 与 Prompts',
    summary: '保留 Pi 原生生态：发现、安装和管理能力包，而不是把工具锁死在应用内部。',
    items: [
      '统一扩展清单与单项启停，设置与 Session 启动使用完全相同的加载计划',
      'Skills 搜索、安装、更新检查与精确启停',
      'Plugin 包安装、移除、更新、启用与资源详情',
      '运行时 MCP Server 和工具能力发现，不暴露凭据或工具输入 Schema',
      'Slash commands、Prompt 资源和第一方扩展状态直接进入对话体验',
      '空闲 Session 可立即重启扩展；忙碌任务在下一次重启时安全应用设置',
    ],
  },
  {
    id: 'automations',
    number: '10',
    title: '计划任务与持续跟进',
    summary: '提醒、监控、定期检查和项目作业交给 Piora 自己的持久化调度器。',
    items: [
      'RRULE 与时区感知的重复计划、暂停 / 恢复、立即运行和安全删除',
      'Chat heartbeat 在原会话继续；项目任务每次运行创建新会话',
      '错过运行后的恢复策略、有界执行历史和单次运行详情',
      '对话内任务卡片、设置页总览与右侧完整编辑器',
      '可配置桌面完成通知，并由 Agent 在用户明确要求时创建或管理',
    ],
  },
  {
    id: 'personalization',
    number: '11',
    title: '外观、桌宠与效率细节',
    summary: '工作台可以安静克制，也可以完全变成你的风格。',
    items: [
      'Light、Dark、Midnight、Forest、Dream Skin 五种配色主题',
      '20 张原创本地 WebP 背景，支持侧栏 / 工作区独立透明度、遮罩和模糊',
      '本机 PNG / JPEG / WebP / AVIF 背景优先存 IndexedDB，不上传',
      '字体偏好、键盘导航、焦点管理、可调整面板与窄屏布局',
      '可选桌宠显示会话状态、TODO 与快捷短语，并安全导入本机声明式素材',
      'Enter / Ctrl+Enter 发送偏好、运行中消息默认 Steer / Queue 选择',
    ],
  },
  {
    id: 'desktop',
    number: '12',
    title: '桌面交付、更新与本地安全',
    summary: '从安装到升级都清楚可控；默认不把你的工作区变成远程服务。',
    items: [
      'Windows 安装版、单文件 Portable、解压即用 ZIP 与 Linux x64 AppImage',
      'Windows 安装版支持应用内检查更新、下载进度、发行说明与安装重启',
      '系统托盘、窗口位置恢复、动态本地端口和每次启动随机桌面令牌',
      '可选迁移完整 Pi 数据目录，先校验、分阶段复制并保留原目录备份',
      '无分析 SDK、无广告、无账号服务、无默认遥测；项目文件默认留在本机',
      '渲染隔离、错误恢复页、后台任务状态对账与可选原生完成通知',
    ],
  },
] as const;

export const quickStartSteps = [
  { title: '下载并安装', text: 'Windows 新手优先选安装版；想免安装就选 Portable 或 ZIP；Linux x64 使用 AppImage。' },
  { title: '连接你的模型', text: '打开「设置 → 模型」，选择提供商，用 API Key 或 OAuth 登录，保存后跑一次连接测试。' },
  { title: '打开项目或直接聊', text: '做代码任务时选择项目文件夹；临时问答直接在 Chat 区开始，不必选择目录。' },
  { title: '描述结果，而不是步骤', text: '例如：「检查登录流程，修复发现的问题，跑完测试并总结改动。」过程交给 Piora。' },
  { title: '审阅改动，继续推进', text: '右侧查看文件、Diff 和 Git 状态；运行中可以 Steer 调整方向，或 Queue 排队下一条要求。' },
] as const;

export const promptRecipes = [
  ['理解项目', '先阅读 README 和项目规则，画出架构图，再告诉我最适合从哪里开始。'],
  ['修复问题', '复现这个问题，定位根因，实施最小修复，运行相关测试并汇报证据。'],
  ['规划复杂工作', '使用计划模式分析需求，列出有依赖关系的步骤、风险和验收标准，先不要改文件。'],
  ['持续执行', '使用目标模式完成这项任务；除非真正完成或遇到具体阻塞，否则继续推进。'],
  ['组建团队', '创建一个团队：规划者拆解任务，执行者并行实现，审查者独立验收，最后统一汇总。'],
] as const;

export const faqs = [
  ['Piora 是什么？', 'Piora 是 Pi 的开源桌面工作台。它复用 Pi 的 AgentSession、模型、工具、skills 与 extensions，并补充现代桌面界面、文件和 Git 工作区、多人协作、设备自动化与本地安全边界。'],
  ['它和 Pi、pi-web、OpenAI 或 Codex 是什么关系？', 'Piora 基于 pi-web 演进并面向 Pi 运行时，由社区独立维护；它不隶属于或代表 Pi、pi-web、OpenAI 或 Codex。'],
  ['必须会编程吗？', '不必。你可以先从 projectless Chat 开始普通问答；需要处理项目时再选择文件夹。页面上的五步指南和可复制提示词覆盖了第一次使用。'],
  ['我的代码和图片会上传吗？', 'Piora 没有分析 SDK、广告、账号服务或默认遥测。项目文件和自定义背景默认留在本机；模型请求、OAuth、第三方扩展和你主动选择的视觉模型会按相应提供商规则联网。'],
  ['免费吗？', '免费。Piora 本身以 MIT 协议开源，不收费、不内置会员；你只需要为自己的模型 API 用量向提供商付费。'],
  ['Windows 为什么会显示安全提示？', '当前公开安装包未做代码签名，Windows 可能显示信誉警告。请只从官方 GitHub Releases 下载，并用同一发行页的 SHA256SUMS.txt 校验文件。'],
  ['HarmonyOS 自动化会绕过手机安全限制吗？', '不会。它需要用户安装官方 HDC / UiTest 并连接授权设备，不支持绕过锁屏、验证码、支付、系统授权或应用权限。'],
] as const;
