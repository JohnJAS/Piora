# 第一次连接和测试

1. 安装 GitHub Releases 的 Windows 桌面 beta。通过 DevEco Studio 安装适合设备的 SDK/HDC；打开手机开发者选项、USB 调试，并在手机确认电脑授权。
2. 打开右侧 Harmony 面板，选择检测到的 HDC 与手机。在“设备测试工作台 → 诊断”运行只读检查。多台设备必须明确选择；Agent 的设备归属不会跟随面板选择改变。
3. 投屏缺少服务时，点击显式初始化，核对制品来源和 SHA-256 后批准。手机锁定或锁状态未知时请手动解锁；预览不会安装、启动服务、唤醒或解锁手机。
4. 点击手动控制，在测试应用内观察当前画面，再尝试一次安全点击。未知原生几何时禁止坐标输入；可用时保留语义观察。
5. 在“应用”按名称或包标识搜索，选择查询得到的启动入口。旧系统不提供名称时显示实际包标识，不猜应用名称或 ability。
6. 在“场景”载入模板，填写参数、预览步骤后执行；“记录”查看通过、失败、未执行步骤及恢复条件。新用户可先用 [测试工程](../../tests/harmony-fixture/README.md)。

Agent 推荐顺序：`harmony_control` 的 `list_devices → capabilities → discover → observe_page → act/run_scenario → verify`。普通点击和输入需要当前任务的应用授权；危险操作单次批准。面板只读观察无需控制租约。

继续阅读 [控制与停止](controls.md)、[语音](voice-input.md)、[故障处理](troubleshooting.md)。
