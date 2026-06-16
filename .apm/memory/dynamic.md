---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-06-15 14:00:00'
---
# bug: message-batch-header-use-theme

- **现象**: Toast/错误条 `useTheme must be used within ThemeProvider`
- **触发**: 进入【隐藏/恢复消息】批量模式（MessageBatchHeader 挂载）
- **根因**: MessageBatchHeader 内部 useTheme()；父级 ChatConversationPanel 已有 tokens 却未传入
- **修复**: MessageBatchHeader 改 tokens prop；顺带提交 selectRange 范围全选未 commit 改动
- **分支**: fix/message-batch-header-use-theme
