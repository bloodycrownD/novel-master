---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-05-25 23:22:35'
---
2026-05-25: 完成 message-visibility SPEC。代码探索：ChatMessage 模型、chat_message 表、MessageService/Repository、prompt 渲染、fork/copy 逻辑。设计方案：添加 hidden 字段（默认 false），Repository 层实现 updateHidden/updateHiddenRange，Service 层实现 hide/show/hideRange/showRange，CLI 添加 hide/show 命令（支持单个和批量），prompt render 过滤隐藏消息，fork/copy 保留隐藏状态。测试策略包含 8 个单元测试和 4 个 E2E 场景。风险：SQLite 版本兼容性、现有数据迁移。下一步：等待用户确认 SPEC 后开始实现。