---
date: 2026-06-21
dependency: Iterations/vfs-user-ops-unified-tool-turn/prd.md
---

# 用户 VFS Turn 正确性加固（chat-user-vfs-turn）PRD

## 背景

[`vfs-user-ops-unified-tool-turn`](../../../vfs-user-ops-unified-tool-turn/prd.md) 已落地用户 VFS 统一 tool turn：`executeOp` 经 `ToolRunner` **立即写盘**并 append `user_vfs_pending_json`；用户发送或空续跑时 `flushPendingUserVfsTurns` 将 pending **合并落库**为 UA 两段（`user_vfs_action` + `user_vfs_ack`）并 **capture checkpoint**（锚定 action user 条）。

`packages/core` Chat 领域代码审查（[explore.md](./explore.md)）在单写者 Desktop/CLI 主路径下评级 **B+**，主流程可用，但 `UserVfsTurnService` 存在两处 **P1 正确性缺口**：

| 缺口 | 位置 | 现象 |
|------|------|------|
| **多 tool 部分失败** | `user-vfs-turn.service.ts` `executeOp` L88–96 | `ToolRunner.runParallel` 会跑完所有 tool；任一失败返回 `{ ok: false }` 且 **不写 pending**（正确），但 **已成功 tool 的磁盘 mutation 未回滚** |
| **flush 非事务** | `user-vfs-turn.service.ts` `flushPendingUserVfsTurns` L125–159 | action append、ack append、pending 清空、checkpoint capture 为 **四次独立 await**；中途失败可能 transcript 与 pending/checkpoint **不一致** |

典型触发：锚点 **多 hunk `edit` save**（`mapUserSaveToToolUses` 产出多个 tool）中后续 hunk 失败；或 flush 过程中第二次 `append` / `setUserVfsPendingJson` 抛错。

**本需求不扩展** unified tool turn 产品能力（UA 形态、burst 合并、桥接 assistant、UI），仅加固 Chat 编排层的 **原子性与失败语义**，与 `core-explore-remediation` Phase 2 对齐。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| `executeOp` 全有或全无 | 单次 op 内任一 tool 失败时，会话 scoped VFS **回到 op 开始前** mutating path 状态；pending **仍不入队** |
| `flushPendingUserVfsTurns` 消息与 pending 一致 | action + ack 两条消息 append 与 pending 清空 **同一 SQLite 事务**提交；失败时 **无**「仅有 action 无 ack」或「已落库但 pending 仍在」 |
| checkpoint 失败可观测 | capture 在消息事务 **提交后**执行；失败 **向上抛出**（不吞错），调用方可重试或提示用户 |
| 回归零破坏 | 现有 `user-vfs-turn.service.test.ts` 及 agent flush 顺序用例（F1–F4）保持通过；`npm run test:fast` 无新增失败 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Desktop / Mobile 文件编辑用户 | 大改触发多 hunk `edit`；中间 hunk 因锚点/版本冲突失败，期望 **整次保存未生效**，磁盘与 pending 一致 |
| 会话续跑用户 | pending 非空时发送或空续跑触发 flush；期望 **要么** 完整 UA + 清空 pending + checkpoint，**要么** 全部不变、可重试 |
| 核心库维护者 | 修改 `UserVfsTurnService` 后依赖集成测验证 execute/flush 边界，避免 silent half-state |

## 范围

### 包含范围

- `packages/core/src/service/chat/impl/user-vfs-turn.service.ts`：
  - `executeOp`：失败路径 **补偿回滚**（或等价全有或全无策略，见 SPEC）
  - `flushPendingUserVfsTurns`：**事务化** append + pending clear；checkpoint 失败语义
- 为上述行为扩展 **`UserVfsTurnService` 工厂 deps**（注入 `TdbcConnection` 或 tx 编排 helper，与 `message.service` fork/delete 模式一致）
- 新增/扩展 `packages/core/test/chat/user-vfs-turn.service.test.ts`：
  - 多 tool 部分失败 → 磁盘恢复、pending 仍空
  - flush 中途失败模拟 → pending 与 message 行数不变
- 必要时最小调整 `user-vfs-turn.port.ts` 结果类型（如失败时可选 `rolledBack: true`），**不**改 Desktop/Mobile IPC 契约除非类型扩展向后兼容

### 不包含范围

- unified tool turn **产品**变更（U-A-U-A 四段 vs 当前 UA 两段、compress tool_use、LLM export）
- `flushPendingUserVfsTurnsWithTrailingUserReorder`（`run-agent-turn.ts`）的 **末条 user 删除/重挂** 事务化 — 可在 SPEC 记为关联风险；本迭代 **不强制** 一并改 agent 编排
- `session.copy` worktree、`message.append` seq 竞态、fork checkpoint 策略（explore 其它 P1/P2，归属其它 feature）
- `ToolRunner.runParallel` 全局语义变更（仅 user VFS `executeOp` 路径）
- pending queue save 路径 Zod 重校验、XML attribute parser 等 P2/P3 可维护性项

## 核心需求

1. **executeOp 全有或全无：** 在调用 `ToolRunner` 前，收集本 op 所有 mutating path 的 **起始 head**（path → revision/version 或等价快照 token）。全部 tool 成功后 append pending（现有逻辑）。**任一** tool 返回 `ok: false` 或抛错时：将已 mutating 的 path **恢复至起始 head**，再返回 `{ ok: false, error }`；**禁止**部分成功磁盘 + 空 pending 长期并存。
2. **executeOp 成功路径不变：** 单 tool 成功、burst 多次 `executeOp`、flush 不重跑 ToolRunner 等既有验收保持。
3. **flush 事务边界：** `mergePendingVfsTurns` → wrap → **一次** `conn.transaction` 内：append `user_vfs_action`、append `user_vfs_ack`、pending 置 `null`（或 `[]`）。事务失败则 **零条** 新消息且 pending 不变。
4. **checkpoint 顺序：** 消息事务 **commit 成功后** 调用 `messageCheckpoint.capture(sessionId, projectId, actionUser.id)`；capture 失败 **抛出**至调用方（与 explore「fire-and-forget 吞错」 remediation 方向一致，本 feature 仅覆盖 user VFS flush 路径）。
5. **单写者假设保留：** 不引入 session 级 mutex；文档注明多 client 并发 `executeOp` 仍 **未支持**（explore 已知限制）。
6. **错误面：** 回滚失败（极端）须返回/记录 **二次错误**，优先保证 caller 知晓 op 未完整成功；UI 可 toast 现有 `{ ok: false }` 路径。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| E1 | 会话 scoped VFS 基线；`executeOp` 含 2+ tool 且第二个 tool 配置为失败 | 调用 `executeOp` | 返回 `ok: false`；`user_vfs_pending_json` 为 null；**所有**本 op mutating path 内容与基线一致 |
| E2 | 同上，全部 tool 成功 | 调用 `executeOp` | 返回 `ok: true`；pending 增加 1 条；磁盘反映全部 mutation |
| E3 | pending 含 1+ 条；DB 可注入「第二次 append 失败」 | 调用 `flushPendingUserVfsTurns` | 事务回滚：`listBySession` 消息数不变；pending JSON **仍为 flush 前内容** |
| E4 | pending 非空；正常 flush | 调用 `flushPendingUserVfsTurns` | 新增 2 条（action user + ack assistant）；pending 清空；`capture` 被调用且 `messageId` 为 action user id |
| E5 | flush 消息事务成功；mock `capture` 抛错 | 调用 `flushPendingUserVfsTurns` | 调用方收到 rejected Promise；pending **已空**、2 条消息 **已存在**（capture 可后续重试 — SPEC 定案是否提供 repair API） |
| E6 | 现有 F1–F4、burst、bridge、不重跑 ToolRunner 用例 | `npm run test:fast` | 全部通过 |
| E7 | 单 tool 失败（现有 `execute 失败不写 pending`） | 回归 | 行为与 E1 一致（单 tool 为 E1 退化 case） |

## 约束与依赖

- **前置能力：** [用户 VFS 操作统一 Tool Turn PRD](../../../vfs-user-ops-unified-tool-turn/prd.md) — pending 队列、UA flush、checkpoint 锚点、ToolRunner 即时执行语义。
- **关联（非阻塞）：** [message-checkpoint-and-agent](../message-checkpoint-and-agent/) 迭代处理 agent capture fire-and-forget；本 feature 仅保证 **user VFS flush** 路径 capture 不吞错。
- **迭代位置：** `core-explore-remediation` **Phase 2**（readme 第 14 项）。
- **文档后续：** 本 PRD 确认后编写 [spec.md](./spec.md)（design-proposal），再实施代码。
