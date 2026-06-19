---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-19 14:00:00'
---
## stream-display-rewrite（spec 待确认，基线=main）
- 文档: `.apm/kb/docs/Iterations/stream-display-rewrite/{prd,spec,research}.md`
- 实现起点: **main**（非 feature/mobile-stream-display-pacing）
- main 流式: streamBuffer 64ms + pushStreamDelta；无 pacer
- 策略: assistant-ui + adapter；删 chat WebView 流式；保留 RichDocumentWebView
- 菜单: ⋯ 按钮；pacing 分支 b3dddb46 仅留存

## vfs-flush-insert-after-assistant（2026-06-17，已实现）

- 路径：bugs/vfs-flush-insert-after-assistant/
- 修复：lushPendingUserVfsTurnsWithTrailingUserReorder — pending 非空 + 空续跑时删尾 user → flush UA → 写回
- 新增 hasPendingTurns；flush 失败 finally 恢复
- 测试 F1–F4 + UI message-blocks status
- 提交：8e34415e, d8dbcc8b, b27b8662, 5953bd38
- 状态：merge-ready，待 PR