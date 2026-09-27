# 升级与旧入口

保留 `harmony_control` 网关和旧 `harmony_*` 操作名；`help` 可获取操作 schema。新增 capabilities、discover、applications、observe_page、act、speak 和共享场景模板。坐标动作现在检查实际几何；无法验证的旧假设会明确报错。

旧的 metadata-only approval 已替换为实际派发前审批。旧脚本不能把“获取租约”视为对所有应用的授权；需要用户在工作台批准任务应用范围。旧坐标兜底、失败后重复发送和自动解锁不作为兼容回退。

输入校准与声学配置不跨设备/OS 自动迁移。旧会话与编码工具继续使用统一普通会话，不恢复历史 restricted runtime profile。历史方案仅供了解决策，现行入口为 [设备指南](../HARMONYOS_DEVICE_AUTOMATION.md)。
