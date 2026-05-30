---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-05-30 22:00:00'
---
2026-05-30: 合并 **global-compaction-policy** 至 main：压缩策略从 AgentDefinition 解耦为全局 **CompactionPolicy**（KKV）；CLI `nm compaction`；摘要 `agentId` + agents registry；mobile「我的 → 压缩策略」。PRD/SPEC：`.apm/kb/docs/Iterations/global-compaction-policy/`。

2026-05-30: 合并 **mobile-prototype-session-drawer** 至 main（`examples/mobile`）：顶栏 ☰ 按 `chatSubview` 分流；会话操作抽屉；会话日志时间线。PRD/SPEC：`.apm/kb/docs/Iterations/mobile-prototype-session-drawer/`。

2026-05-25: 完成 message-visibility SPEC。代码探索：ChatMessage 模型、chat_message 表、MessageService/Repository、prompt 渲染、fork/copy 逻辑。设计方案：添加 hidden 字段（默认 false），Repository 层实现 updateHidden/updateHiddenRange，Service 层实现 hide/show/hideRange/showRange，CLI 添加 hide/show 命令（支持单个和批量），prompt render 过滤隐藏消息，fork/copy 保留隐藏状态。测试策略包含 8 个单元测试和 4 个 E2E 场景。风险：SQLite 版本兼容性、现有数据迁移。下一步：等待用户确认 SPEC 后开始实现。