---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-18 00:40:47'
---
## vfs-flush-insert-after-assistant（2026-06-17，已实现）

- 路径：bugs/vfs-flush-insert-after-assistant/
- 修复：lushPendingUserVfsTurnsWithTrailingUserReorder — pending 非空 + 空续跑时删尾 user → flush UA → 写回
- 新增 hasPendingTurns；flush 失败 finally 恢复
- 测试 F1–F4 + UI message-blocks status
- 提交：8e34415e, d8dbcc8b, b27b8662, 5953bd38
- 状态：merge-ready，待 PR