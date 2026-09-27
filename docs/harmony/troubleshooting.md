# 故障处理

| 原因码/状态 | 下一步 |
| --- | --- |
| HDC_NOT_FOUND / HDC_INVALID | 在诊断中选择真实 SDK 内的 HDC 绝对路径，重新检测 |
| unauthorized | 在手机上允许 USB 调试 |
| SCREEN_LOCKED | 手动解锁；未知锁状态也不会自动唤醒或滑动解锁 |
| APPROVAL_REQUIRED | 工作台核对任务、应用、参数与制品 hash，批准后重试原操作 |
| OBSERVATION_UNAVAILABLE | 检查 UiTest 权限/前台窗口，再刷新；不可把空树当控件消失 |
| STALE_SNAPSHOT | 获取新的 UI 引用或实时几何，不重复旧坐标 |
| needs-calibration | 在当前设备与系统重新校准精确保持时长或声学配置 |
| LEASE_CONFLICT / DEVICE_BUSY | 查看控制者；先结束持有任务或显式接管，不停止其他手机 |
| recovering / cleanup uncertain | 查看手机实际释放状态及工作台诊断，不宣称动作已撤销 |
| COMMAND_TIMEOUT | 保存操作收据，先观察实际效果，再决定是否安全重试 |

USB 拔出时可导出默认支持包，它不等待新的读屏。需要带截图/树的支持包会真实请求设备，超时会失败。CLI 检查显示 incomplete 时先配置 DevEco Studio；不要通过忽略检查安装。
