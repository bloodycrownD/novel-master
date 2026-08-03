---
date: 2026-06-15
dependency: Iterations/vfs-user-ops-unified-tool-turn/prd.md
---

# desktop-hide-restore-range-selection Bug PRD

## 背景

vfs-user-ops-unified-tool-turn 迭代交付了【隐藏消息】/【恢复消息】专用多选。隐藏确认后执行 `hideRange(1, maxAssistantSeq)`，恢复执行 `showRange(minUserSeq, maxSeq)`，即影响的是 **seq 区间内的全部消息**，而非仅被勾选的可选行。

## 现象描述

Desktop 进入隐藏模式后勾选一条 assistant，仅该行显示选中态；同区间内的 user 消息无视觉反馈。底部 batch bar 文案为「已选 1 项」，易误解为只隐藏一条 assistant。恢复模式同理。

## 复现步骤

1. 打开 Desktop 会话，存在若干 user / assistant 交替消息。
2. 会话菜单 → 【隐藏消息】。
3. 勾选中间或靠后的一条 assistant。

## 预期行为

- 勾选 assistant 后，**seq 1 至该 assistant（含）** 的所有消息（含 user）均显示为「将影响」范围。
- 恢复模式勾选 user 后，**该 user 至会话末** 的所有消息均显示为将影响范围。
- 底部栏说明区间与条数，例如「将影响 N 条（seq 1–S）」。

## 实际行为（修复前）

- 仅 `selectedIds` 内的行有 `is-selected` 高亮。
- user 等不可勾选行无范围预览。

## 影响范围

- Desktop Transcript 隐藏/恢复 UX。
- Mobile / WebView transcript 同步改进（同一语义）。

## 验收标准

1. 隐藏：勾选 1 条 assistant → 所有 `seq <= S` 消息有 `is-in-range` 高亮。
2. 恢复：勾选 1 条 user → 所有 `seq >= S` 消息有高亮。
3. batch bar 展示将影响条数与 seq 区间。
4. Desktop batch bar 样式：sticky 底栏、主次按钮清晰。

## 回归测试要点

- `computeVisibilityBatchAffectedIds` core 单测。
- 确认后仍调用原有 `hideRange` / `showRange`，行为不变。
