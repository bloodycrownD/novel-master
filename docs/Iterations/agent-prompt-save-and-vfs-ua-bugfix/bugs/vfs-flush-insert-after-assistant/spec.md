---
date: 2026-06-17
---

# vfs-flush-insert-after-assistant Bug 修复规格（SPEC）

## 根因分析

### 1. Flush 落库位置

`DefaultUserVfsTurnService.flushPendingUserVfsTurns` 对 `messages.append` **仅尾部追加** UA 两条，未读取会话末条角色。

### 2. 与 run-agent-turn 的协作

`run-agent-turn.ts` 固定顺序：

```text
flushPendingUserVfsTurns()
→ 若 trimmed !== "" → append user 正文
→ run agent
```

空续跑（`allowResumeWithoutInput`）时 **不 append** 新 user，但 flush 已在末条 user **之后** 写入 UA，导致 UUA。

### 3. 与「不成对兜底」的关系（只读结论，本 bug 不改动该语义）

| 机制 | 层级 | 行为 |
|------|------|------|
| 空发续跑 | UI `deriveComposerSendState` + Core `runAgentTurn` | 末条可见消息 `role === user` 时允许空发；Core 校验末条为 user 后 **不 append** 新 user，**直接** flush + run agent |
| tool_result 末条 + 带文字发送 | UI `ChatComposer` | **弹窗确认**后 `appendToolTurnBridge`（【done】），再 `runAgent`；非自动兜底 |
| plain user 末条 | UI | 禁止 **带文字** 发送（`lastMessageIsPlainUserText`），仅可空发续跑 |
| VFS flush | Core | **无** 成对检查；pending 非空则 flush，**始终 append 到末尾** |

因此：**底层对「末条 user 不成对」有空发续跑闸门，但没有在 flush 时重排消息**；不是「先自动插桥再发」，空发是 **直接** flush + 跑 Agent。

---

## 修复方案

**保留 flush 与 UA 两条**；变更 **插入锚点** 与 **末条 user 重排**。

### 锚点规则

1. 在会话可见消息中定位 **最后一条 `role === assistant`** 的消息下标 `lastA`。
2. UA 两条应落在 **`lastA` 之后**（若存在 `lastA`）。
3. 若 `lastA` 不存在（会话尚无 assistant），落在序列 **开头之前** 等价于 index `0` 前插入 → 实现为 **append 在第一条消息之前** 或 **作为前两条**（见边界）。

### 末条 user 重排（空续跑 / flush 前末条为 user）

当 `list[list.length - 1].role === user` 且该 user **不是** 本次 `trimmed !== ""` 即将 append 的新正文时：

1. **暂存** 末条 user 的完整 payload（content、raw/metadata、hidden 等）。
2. **删除** 该条（或 hide + 逻辑删除，须与项目 message 删除 API 一致）。
3. 在 `lastA` 之后 **插入 UA 两条**（实现可用：删尾 user 后 append UA，再 append 暂存 user）。
4. 若 `trimmed !== ""`，再 append **新** user 正文（与现逻辑一致）。

效果：

```text
原：… A? … U_trailing
后：… A … U(VFS) A(ack) U_trailing [U_new?]
```

### 与现测试的关系

- `run-agent-turn.test.ts`「flush 在 append user 之前」在 **末条为 assistant** 时仍成立。
- 需新增 **末条为 user + flush** 顺序用例。

---

## 变更点清单

| 文件 | 变更 |
|------|------|
| `user-vfs-turn.service.ts` | flush 接受插入策略或先由 orchestrator 准备好序列；或拆 `flushToSessionAfter(lastAssistantSeq)` |
| `run-agent-turn.ts` | 空续跑/发送前协调：暂存尾 user → 调 flush（插在最后 A 后）→ 恢复尾 user → append 新正文 |
| `message.port.ts` / repo | 若缺「按 seq 插入」或「删除单条」能力，扩展最小 API（优先复用现有 delete + append） |
| `user-vfs-turn.service.test.ts` | 末条 user 场景顺序断言 |
| `run-agent-turn.test.ts` | 空续跑 + flushed 顺序 |

**不在此 bug 范围**：合并 UA 进单条 user message；legacy 四段迁移；Composer 三分支规则变更。

---

## 详细改动说明

### Phase 1：Core 插入编排（推荐放在 `run-agent-turn` 或 `user-vfs-turn.service` 单入口）

伪代码：

```typescript
async function prepareFlushInsertion(sessionId: string, trimmed: string) {
  const list = await messages.listBySession(sessionId);
  const last = list[list.length - 1];
  const trailingUserToReappend =
    last?.role === "user" && trimmed === "" ? last : null;
  // 若 trimmed !== "" 且 last 是 user：该 user 是否重排？定案：仅空续跑重排「待续跑」末条；
  // 带正文发送时末条 user 通常不应存在（plain user 禁止带文发）；若存在按同规则重排。

  if (trailingUserToReappend != null) {
    await messages.delete(sessionId, trailingUserToReappend.id); // 或等价 API
  }

  await userVfsTurn.flushPendingUserVfsTurns(sessionId, {
    insertAfterMessageId: findLastAssistant(list)?.id,
  });

  if (trailingUserToReappend != null) {
    await messages.append(sessionId, "user", trailingUserToReappend.content, { raw: trailingUserToReappend.raw });
  }
}
```

`flushPendingUserVfsTurns` 实现选项（二选一）：

- **A（推荐）**：flush 内 `listBySession` → 计算插入点 → 若仅支持尾 append，则 **先删尾 user → append UA → append user**（与 orchestrator 合并，避免双处删写）。
- **B**：message 层支持 `insertAfter(seq|id)`，UA 插入后 seq 重排。

checkpoint 仍锚 **U(VFS)** 条（与 agent-prompt-save-and-vfs-ua-bugfix spec 一致）。

### Phase 2：边界

| 场景 | 行为 |
|------|------|
| 无 assistant、有 user | UA 插在会话最前（index 0），再 append 原 user |
| 无 pending | flush no-op，不重排 user |
| 末条 assistant | 与现行为一致：UA 紧接 A 后，再 append 新 user 正文 |

---

## 测试策略

### 测试用例

| ID | Given | When | Then |
|----|-------|------|------|
| F1 | `A, U` + pending | 空续跑 | 顺序 `A, U_vfs, A_ack, U`（原 U 内容保留） |
| F2 | `A` + pending | 发送「hi」 | `A, U_vfs, A_ack, U(hi)` |
| F3 | 仅 `U` + pending | flush | `U_vfs, A_ack, U` 或 spec 定案 |
| F4 | pending 空 | 空续跑 | 无 UA，末条仍为 `U` |
| F5 | F1 完成后 | message-blocks | VFS 卡片 `status === success` |

### 命令

```bash
npm test --workspace=@novel-master/core -- --test-path-pattern="run-agent-turn|user-vfs-turn"
npm test --workspace=@novel-master/mobile -- message-blocks
```

---

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 删/重插 user 导致 message id 变化 | 单测覆盖；回滚/同步依赖 seq 而非 id 处需回归 |
| insert API 缺失 | 首版用删尾 + 尾 append 三段式，不强制 seq insert |
| 与 tool_result 续跑冲突 | 末条 user 含 tool_result 时走 bridge 弹窗，本 bug 不改变该路径 |

回滚：恢复 flush 纯尾 append + 移除 user 重排逻辑。
