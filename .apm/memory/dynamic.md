---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-06-14 00:30:00'
---
# chat-workspace-agent-sync — 已合并 fix 分支，真机验收通过

**分支**：`feature/chat-workspace-agent-sync`（已 merge `fix/glm-tool-stream-stalled-metrics`）

**UX 终态**：
- 两事件：stream「工具调用中」+ assistant 落库 pending 工具卡
- metrics 条：计时 + 正文/思考字数（无 tool 计数）

**真机**：用户确认无 bug（2026-06-14）

**未纳入本次 merge**：`scripts/release.mjs`、`prompt-engine-three-regions` 文档（无关）
