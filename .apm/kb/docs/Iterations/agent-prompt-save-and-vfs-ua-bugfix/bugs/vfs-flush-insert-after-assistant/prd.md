---
date: 2026-06-17
dependency: Iterations/agent-prompt-save-and-vfs-ua-bugfix/prd.md
---

# vfs-flush-insert-after-assistant Bug PRD

## 背景

VFS UA 简化后，用户工作区操作在发送时经 `flushPendingUserVfsTurns` 落库为 **UA 两条**（`user_vfs_action` + `user_vfs_ack`）。当前实现将 flush 结果 **追加到会话末尾**，未考虑末条消息角色。

在 **空输入续跑**（末条已是 user、Composer 允许空发）且存在 pending VFS 时，flush 会插在用户气泡 **下方**，形成 `U(用户) → U(VFS) → A(收到通知)` 的 **UUA** 顺序，与「VFS 属于上一轮 Assistant 之后的用户侧操作」的语义不符。

本 bug 归属 [agent-prompt-save-and-vfs-ua-bugfix](../../prd.md) 迭代，修复 flush **插入位置**，不改动 UA 两条形态与工具卡片 UI。

## 现象描述

- 会话末条为 **普通 user 消息**（含空发续跑、maxSteps 截断后待续跑等场景）。
- 用户在聊天工作区执行 VFS 操作（产生 pending），随后 **空发送** 或 **带正文发送**。
- flush 后时间线中，**用户操作（VFS）卡片出现在用户文本气泡之下**，而非上一轮 Assistant 之后。

## 复现步骤

1. 与 Agent 对话，使会话末条为 **user**（例如模型未回复完用户已发话、或空发续跑前末条即为 user）。
2. 在聊天工作区对 VFS 执行若干操作（save/edit/fs 等），不立即发送。
3. 回到聊天，**空发送**（或输入新消息后发送）。
4. 观察消息顺序：用户气泡下方出现「用户操作 (N)」VFS 卡片及「收到通知」。

## 预期行为

- flush 产生的 UA 两条应插在 **最后一条 Assistant 消息之后**。
- 若发送前末条为 **user**（空续跑不新增 user、或待重排的 user），该 user 应在 flush **之后** 重新出现（删后重写或等价 seq 调整），最终顺序为：

```text
… → A(末条 assistant) → U(VFS) → A(收到通知) → U(用户，若有) → A(模型回复)
```

- 工具卡片仍显示 **成功**（非「执行中」）；UI 不出现 UUA 夹在两条 user 之间的观感。

## 实际行为

- `flushPendingUserVfsTurns` 对 `messages.append` 仅 **尾部追加**。
- `run-agent-turn` 顺序为：flush →（若有正文）append user → run agent。
- 末条为 user 时，flush 紧接在该 user **之后**，形成 UUA。

## 影响范围

- **Core**：`user-vfs-turn.service` flush 落库位置；`run-agent-turn` 与 flush 协作（末条 user 暂存/重插）。
- **消息序与回滚**：message id / seq 可能变化，需评估 checkpoint、visibility、同步。
- **Mobile / Desktop**：Composer 空发与带文发送路径均受影响；UI 列表顺序改善，无卡片样式变更。
- **历史会话**：已错误顺序的 UA 段不迁移，仅修复 **新 flush**。

## 验收标准

- **Given** 末条为 user 且存在 pending VFS，**When** 空发送续跑，**Then** 时间线为 `…A → UA(VFS) → U(原末条 user)`，不出现 `U(用户) → UA`。
- **Given** 末条为 assistant 且存在 pending，**When** 带正文发送，**Then** 时间线为 `…A → UA → U(新正文)`（与现「先 flush 后 append」语义一致，仅 flush 锚定在末条 A 后）。
- **Given** flush 成功，**When** 查看 VFS 工具卡片，**Then** 状态为 **成功**。
- **Given** 会话中无 assistant（仅 user），**When** flush，**Then** 行为按 spec 边界处理（见 spec），不抛未处理错误。

## 回归测试要点

- `run-agent-turn`：空续跑 + flush 的消息顺序断言。
- `user-vfs-turn.service`：插入点非末尾时的集成测试。
- Mobile `message-blocks`：UA 折叠与工具状态仍为 success。
