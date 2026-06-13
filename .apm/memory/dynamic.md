---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-06-13 23:30:00'
---
# refactor: chat-workspace-agent-sync 两事件工具 UX

**分支**：`fix/glm-tool-stream-stalled-metrics`

**UX（用户确认）**：
1. thinking 流结束且无正文 → stream tail「工具调用中」（`useStreamToolInvoking`，idle ≥300ms）
2. assistant 落库含 tool_use → pending 工具卡（「执行中」），去掉 message 行 phase bar

**已删除**：metrics 全链路、TOOL_USE_DELTA、glm-tool-stream/tool_stream、toolPhase UI、freezeToLastRun

**文档**：
- `.apm/kb/docs/Iterations/chat-workspace-agent-sync/prd.md`
- `.apm/kb/docs/Iterations/chat-workspace-agent-sync/spec.md`

**验证**：core test + mobile jest（message-blocks、build-transcript-rows、use-stream-tool-invoking）

**下一步**：真机 GLM 大 write 复测 toolInvoking 时序；确认后 merge
