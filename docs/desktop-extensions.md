# Piora 桌面扩展

「设置 → 桌面扩展」管理 DSH Pet、DSH Meme 和已验证的 Cordis 扩展。Pet 与 Meme 使用各自的专用适配器。扩展目录显示已验证版本、包和素材许可证，以及宿主能提供的服务。DSH 社区目录用于浏览和搜索上游项目，安装使用 Piora 审核过的精确版本和完整性记录。

初始 Cordis 组合固定为 @deepseek-ai/cordis 4.1.0 和 Piora 宿主 API v1。附带的 Piora Task Monitor 由服务插件与面板插件组成，支持从 1.0.0 升级到 1.1.0，并迁移已保存的视图偏好。扩展进程与 Piora 聊天进程各自运行。批准加载的 Node 代码仍拥有当前系统用户的文件和网络权限。

## 兼容清单

在扩展目录清单中增加 profile 和精确 release 即可注册符合宿主约定的扩展。每个 profile 在独立进程使用一个原生 Cordis context。简单 bundle 由清单按组声明插件及其配置。同组插件可用 Cordis 的 provide、inject、effect 共享服务和注册清理函数。

- 包记录包含包名、版本、代码许可证、来源和完整性。内置文件固定 SHA-256。npm 归档固定 SHA-512，所有运行依赖都要在同组显式固定，安装器只解包，不运行 npm 生命周期脚本。
- 插件使用 Cordis 的 apply 或函数入口。声明顶层必需依赖和提供的服务，插件可以通过 get 读取可选服务。健康探针负责确认所在版本实际运行，返回带 ready 和版本的 JSON 对象。客户端版本和 RPC 方法也在清单中声明。
- 客户端使用独立的 Electron 窗口。面板为自包含 HTML，调用 window.pioraExtension.invoke 执行清单已声明的 JSON RPC。面板禁止网络请求、导航、新窗口和系统权限请求。关闭面板会取消派发中的 RPC。启动、更新、停止和卸载都按 profile 操作。
- 需要 DSH 主聊天 DOM、webServer、loader、账户、客户端插槽或 carrier/cross 补丁的组合需要额外适配。安装前拒绝版本、服务或客户端协议不匹配的清单，社区目录中的其他版本显示为未验证。

实际清单和示例插件见 [目录清单](../desktop/src/cordis-extension-catalog.ts) 和 [Task Monitor](../desktop/cordis-plugins/task-monitor)。

## 宿主 API v1

| Piora 服务 | 插件可用的接口 |
| --- | --- |
| pioraTasks | list 读取正在运行和等待确认的状态，省略聊天标识、正文和模型凭据 |
| pioraModels | complete 接收调用方明确传入的文本或受支持的图片，复用桌面的可见模型与模型附件格式。调用有截止时间，支持 AbortSignal，每个 profile 同时运行一个模型请求 |
| pioraNotifications | show 提供标题和正文，通过桌面通知发送 |
| pioraWindows | open 和 close 操作当前 profile 的已验证面板 |
| pioraStorage | read 和 write 读写 profile 自己的 JSON 数据。写入经临时文件和原子重命名 |
| pioraResources | read 读取清单里声明的内置资源或面板文件，以 Base64 返回 |
| pioraLog | write 写入扩展管理页的近期诊断信息 |
| pioraPanel | register 注册 RPC 处理器并返回注销函数，通常放在 Cordis effect 中 |

关闭面板、停止宿主或请求超时会取消受影响的调用。候选版本通过健康检查后，才可以打开该版本的面板。Cordis 自带的 logger 与上述 Piora 服务独立。

## 安装、更新与恢复

安装器先记录候选槽位，再暂存并校验包。更新时先停止该组的旧进程，再复制原数据到独立候选槽位。若数据格式改变，清单要声明允许的源格式和执行迁移的模块。迁移仅写候选副本。健康检查通过后原子切换版本与数据记录，并保留上一可用版本。更新前在运行的 profile 在成功后继续运行。

下载、依赖、迁移或启动失败会保留原来的程序和数据。更新前在运行的版本会尝试恢复运行，失败原因可以在管理页查看。若 Piora 中途退出，重新启动会处理持久事务记录，清除未激活的候选槽位，再按自启动偏好恢复原版本。卸载清理程序并保留数据。重新安装时仍会按清单检查保留数据的格式。

## 验收入口

- node --test lib/cordis-extension-host.test.mjs 验证真实 Cordis 依赖注入、工作进程隔离、客户端 RPC 取消、停止释放、失败回退和重新启动恢复。
- node scripts/run-desktop-e2e.mjs --scenario cordis-extensions 验证真实 Electron 设置、独立原生面板、运行中更新、自启动、错误展示和卸载保留数据。指定 PIORA_DESKTOP_E2E_CORDIS_DISCOVERY=1 可用上游目录做联网验收。
- node scripts/run-desktop-e2e.mjs --scenario desktop-extensions 回归两款专用适配器。模型凭据、外部账户及发版安装包的结果以各自的验收记录为准。
