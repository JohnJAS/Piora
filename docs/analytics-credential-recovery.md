# 组织统计凭证恢复

需要 Analytics 的 POST /v1/installations/credentials/recover 接口及配套数据库字段。服务端接口见 https://github.com/kexijiang/piora-analytics/pull/20 ，客户端 issue 为 https://github.com/kexijiang/pi-desktop/issues/473 。

客户端先尝试正常轮换，包括使用 pending 设备凭证重放丢失的轮换响应。仅当本地设备凭证已到期且轮换返回 401 时尝试恢复，资格仍由服务端校验。设备撤销或恢复被拒绝时不会清空注册状态或生成新设备 ID。

首次恢复重新读取实际 Pi 数据目录中的 piora/telemetry/config.json。默认目录为 %USERPROFILE%/.pi/agent/piora/telemetry；设置 PI_CODING_AGENT_DIR 时跟随该目录。升级初始化保留既有 config.json，分发工具需要更新该文件的 enrollment_key。认证错误暂停后，更新配置并重启 Piora 可重新尝试。配置禁用或后端地址改变时拒绝向旧服务发起恢复。

新秘密、恢复请求和接入授权均先写入现有加密 credentials.dpapi。超时、重启和未知结果使用相同请求及授权重试，即使配置又更新也优先完成待确认请求。服务端明确返回 ENROLLMENT_INVALID 时，丢弃被拒绝的 pending 恢复，下次可使用新配置。成功确认持久保存后才使用新凭证上报，保留安装 ID、队列与历史关联。状态接口增加 recovery_status，仅包含固定状态或 HTTP 状态码。

验证使用临时 SQLite、模拟 HTTP 与安全存储适配器，覆盖并发、响应丢失、重启、磁盘失败和拒绝场景。未验证发布包、真实 Windows DPAPI 与真实服务端的端到端恢复。
