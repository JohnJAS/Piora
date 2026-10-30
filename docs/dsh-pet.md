# DSH Pet 桌面扩展

在 Piora 桌面版打开 **设置 → 桌面扩展 → 安装 DSH Pet**，安装完成后点击 **启动**。首次安装下载约 63 MB 的插件资源及依赖，可查看进度或取消；首次启动由上游下载独立 Electron 窗口运行环境。显示「服务运行中」表示本地服务已就绪，窗口需要等待下载、解压完成。

通过宠物右键菜单调整外观、动作和多开；通过 **AI 设置**配置桌宠聊天与碎碎念使用的服务、模型和密钥。Piora 的模型凭据、余额和聊天内容不会自动共享。浏览器版只显示桌面版使用提示。

**跟随 Piora 任务状态**默认开启：等待审批或用户输入优先显示等待，其次显示正在执行的任务；新完成/失败的任务短暂显示成功/失败，取消不显示成功。仅传递聚合后的状态枚举，不传递会话 ID、标题、消息、工具参数或思考内容。关闭开关会清除外部状态，让上游恢复自身行为。

**随 Piora 启动**默认关闭。停止或退出 Piora 会关闭本次启动的宠物进程和 AI 设置窗口。**卸载（保留数据）**只移除插件程序，保留模型配置、记忆和自定义资源，可通过 **打开数据目录**查看。

## 与现有能力的边界

| 入口 | 内容 | 运行位置 |
| --- | --- | --- |
| 插件、扩展、技能 | Pi Agent 包及模型工具扩展 | Agent 运行时 |
| 宠物设置 | Piora 已有 Companion 宠物 | Piora Companion 窗口 |
| 桌面扩展 | 本次接入的 DSH Pet | 独立进程和透明窗口 |

本次没有引入通用 DSH/Cordis 插件宿主。后续体系支持跟踪在 [upstream #250](https://github.com/kexijiang/Piora/issues/250)。参考了 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) 的独立宿主与运行时生命周期；这里使用 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 发布包的 standalone 入口，不加载 Cordis Profile。

## 安装和隔离

- 固定 `dsh-pet@0.3.8`，校验 npm 发布归档的 SHA-512；安装工具使用固定 `npm@11.6.2` 及归档校验，桌面用户不需要另装 Node/npm。依赖安装禁用生命周期脚本；传递依赖按上游版本约束解析。
- 数据根为 `<Piora userData>/desktop-extensions/dsh-pet`。插件位于 `installed`，上游的 `DSH_HOME` 位于 `home`，npm 配置与缓存也在独立目录中。不会读取现有 DSH 的配置或插件列表。
- 对固定版本 helper 的唯一源码适配是在 `app.setName('dsh-pet-electron-helper')` 后设置独立 Chromium `userData`；锚点不符则安装失败。原作者 LICENSE 与素材文件保留在安装目录。
- 仅受信任的 Piora 主窗口可以调用有限的启停、安装、设置 IPC。宠物的本地端口随机分配，使用它自己的令牌；令牌不返回设置页。AI 设置窗口启用隔离和沙箱，不注入 Piora preload。
- 宠物宿主通过 IPC 管道监测 Piora 退出，透明窗口使用上游的宿主 PID 监测。安装失败/取消只清理暂存区，卸载保留 `home`。
- 安装和宠物网络连接由独立运行时处理，目前不自动继承 Piora 应用内的代理设置；需要能够访问 npm 及上游 Electron 下载源。

## 来源与素材

Piora 没有复制或打包上游动画素材；用户主动安装时从 npm 下载原始发布包。上游代码使用 MIT，原作者动画素材的说明为禁止商用、二创需署名，具体范围以[上游项目和素材说明](https://github.com/PC2005-cloud/dsh-pet)为准。此边界已在安装入口展示。

## 验证入口

```powershell
node --test lib/dsh-pet.test.mjs lib/settings-search.test.mjs
node scripts/run-desktop-e2e.mjs --scenario desktop-extensions
node scripts/verify-dsh-pet.mjs
```

前两项分别验证生命周期/状态/隔离及真实 Electron 设置界面，不下载插件。最后一项是显式联网的原版插件 smoke：在临时目录真实安装、启动、发送工作和完成状态，等待原生 renderer 上报坐标，停止宿主后保存 `report.json`。它会打开实际桌宠窗口，不读取用户模型凭据，不发送模型请求；失败必须按报告如实记录。安装目录和报告保留供排查。

可通过 `--reuse-install <已验证的临时目录>` 复用已校验的程序包到新目录（不复制 AI 配置），报告会明确标注未重新下载。设置 `ELECTRON_RUN_AS_NODE=1` 并用仓库 Electron 可执行文件运行该脚本，可验证桌面进程实际使用的执行路径。
