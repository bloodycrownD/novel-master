---
date: 2026-06-28
dependency: Iterations/chat-workspace-agent-sync/prd.md
---

# abort-partial-persist Bug PRD

> **父级迭代**：[../../prd.md](../../prd.md)  
> **相关**：[../agent-run-lifecycle-unify/prd.md](../agent-run-lifecycle-unify/prd.md)

## 背景

`agent-run-lifecycle-unify` 将 abort 定为「in-flight assistant 不落库 + 即时清 overlay」，与用户在 Mobile 上的预期（保留已流式正文）及 Desktop 多 step 场景下的体验不一致。另 Mobile stream tail 横条文案仍为「工具调用中」，未与 spec「生成中」统一。

## 现象描述

1. Mobile（及双端）点「终止」后，仅存在于流式 overlay 的正文消失，像整段撤回，DB 无 assistant partial。
2. Mobile stream tail idle 横条显示「工具调用中」而非「生成中」。

## 复现步骤

1. 发起 agent run，等待 assistant 流式输出若干正文（尚未结束）。
2. 点「终止」。
3. 观察 transcript：正文消失；DB 无对应 assistant 行（改前）。

## 预期行为

1. **abort 保留 partial**：已生成的 text/thinking/tool_use blocks 截断落库；`RUN_FINISHED(cancelled)` 后 reload 渲染。
2. **overlay**：终止时仍清 stream overlay；reload 后从 DB 显示 partial。
3. **工具卡**：无 tool_result 且 run 已停 →「已中断」（沿用 lifecycle unify）；有 result 按 success/error。
4. **stream tail 文案**：Mobile 横条统一「生成中」。

## 实际行为（改前）

- Core append 前 abort break，partial 不落库。
- `abortUiRun` 清 `activeRunId`，`RUN_FINISHED` 被丢弃，不 reload。
- Mobile UI 硬编码「工具调用中」。

## 影响范围

- Core `agent-runner`
- Mobile / Desktop `useAgentRunLifecycle`
- Mobile `MessageList`、`ToolTurnPhaseBar`、WebView transcript

## 验收标准

- [ ] abort 后 DB 存在 partial assistant（有 stream 内容时）
- [ ] abort 后 UI reload 显示 partial，非空白撤回
- [ ] 工具未执行完显示「已中断」，非永久「执行中」
- [ ] Mobile stream tail 显示「生成中」
- [ ] Core / Mobile / Desktop 相关单测通过

## 回归测试要点

- agent-runner abort partial 落库单测
- Mobile abort → RUN_FINISHED flush reload 单测
- Desktop `shouldIgnoreStaleRunStarted`（abort 后迟到 RUN_STARTED 不复活 uiRunning）
- lifecycle refcount / stale runId 行为不退化
