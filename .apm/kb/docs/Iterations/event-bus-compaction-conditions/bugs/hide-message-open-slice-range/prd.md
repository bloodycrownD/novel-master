---
date: 2026-06-24
dependency: Iterations/event-bus-compaction-conditions/prd.md
---

# hide-message-open-slice-range Bug PRD

## 背景

出厂默认压缩事件 `session.compaction.requested` 配置 `hide-message` 且 `start-depth: 6`（即 depth **6～∞**），产品语义为保留最近 **6** 条可见消息，隐藏更旧上下文。该行为在 `event-bus-compaction-conditions` PRD 中有明确验收。

Mobile 手动压缩接入后，用户反馈「压缩后几乎没藏消息」；`[compact]` 日志显示 `matchedInSlice: 32` 但仅 `hidden +2`。

## 现象描述

手动或自动触发压缩且事件配置为仅 `start-depth: 6` 时，**大量落在 depth≥6 切片内的消息未被 hidden**，仅隐藏边界附近极少数 seq（例如 38 条可见会话中只藏 2 条）。

## 复现步骤

1. 准备可见消息 **≥10** 条的会话（默认压缩条件更易满足）
2. 确认事件配置含 `hide-message` / `start-depth: 6`、无 `end-depth`
3. 执行手动压缩（Mobile 会话菜单或 Desktop/CLI emit）
4. 对比压缩前后：可见条数仅减少 **1～2** 条，而非约 **总数−6**

## 预期行为

对齐父 PRD 验收：

- **Given** 可见消息 10 条，**When** `hide-message` 仅 `start-depth: 6`，**Then** depth **6～9** 的消息全部 hidden，depth **0～5** 仍可见（保留 6 条）。
- 一般情况：`messageIdsInSlice` 命中的 depth≥startDepth 消息，应 **整段** 按 seq **min～max** 隐藏。

## 实际行为

`resolveHideMessageRange` 在仅 `startDepth` 时返回 `{ fromSeq: anchor.seq, toSeq: maxSeq }`，丢弃 **seq 小于锚点 assistant** 但仍属于同一切片的消息，导致只隐藏窄区间（如 seq 32–33）。

## 影响范围

- **Core**：`hide-message` 事件动作（压缩、任意仅 `startDepth` 的 hide 配置）
- **平台**：Mobile、Desktop、CLI 共用 orchestrator，无平台差异
- **不影响**：含 `endDepth` 的有界切片（本就使用 min～max）

## 验收标准

- **Given** 可见 10 条、仅 `start-depth: 6`，**When** 执行 hide-message，**Then** depth 6～9 共 4 条全部 hidden，可见剩 6 条。
- **Given** 用户日志同类会话（visible≈38、matchedInSlice≈32），**When** 压缩，**Then** `hidden` 增量与切片规模一致（约 32），非 2。
- **Given** depth≥startDepth 范围内无 assistant，**When** 执行，**Then** 不 hide（返回 null），行为不变。

## 回归测试要点

- `test/depth/resolve-hide-message-range.test.ts` PRD 用例
- `test/depth/depth-slice.test.ts` 切片命中不变
- `test/events/hide-message.handler.test.ts` 集成路径（CI）
