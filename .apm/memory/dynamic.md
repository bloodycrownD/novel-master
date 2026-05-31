---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-05-31 12:00:00'
---
2026-05-31: **core-package-structure** 已 fast-forward 合并至 **main**（`bf3fba1`）：core 包 domain/infra 目录规整、`ARCHITECTURE.md`、Breaking `createSqliteCompactionAgentResolver`。PRD/SPEC：`.apm/kb/docs/Iterations/core-package-structure/`。

2026-05-31: **core-package-structure** 分支开发完成（合并前记录）：`packages/core/ARCHITECTURE.md` 落地；domain 统一 `model/` / `logic/` / `ports/`、errors 收拢；infra adapter 型（llm-protocol、sksp、tdbc）→ `ports/` + `impl/` + `logic/`；`VfsService` port 下沉 `domain/vfs/ports/`；`zodToJsonSchema` 迁至 `infra/serialization/`。

2026-05-30: 合并 **global-compaction-policy** 至 main：压缩策略从 AgentDefinition 解耦为全局 **CompactionPolicy**（KKV）；CLI `nm compaction`；摘要 `agentId` + agents registry；mobile「我的 → 压缩策略」。PRD/SPEC：`.apm/kb/docs/Iterations/global-compaction-policy/`。

2026-05-30: 合并 **mobile-prototype-session-drawer** 至 main（`examples/mobile`）：顶栏 ☰ 按 `chatSubview` 分流；会话操作抽屉；会话日志时间线。PRD/SPEC：`.apm/kb/docs/Iterations/mobile-prototype-session-drawer/`。

2026-05-25: 完成 message-visibility SPEC（待实现或已合并，见 main）。PRD/SPEC：`.apm/kb/docs/Iterations/message-visibility/`。
