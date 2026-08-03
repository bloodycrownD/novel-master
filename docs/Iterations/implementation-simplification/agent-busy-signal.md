---
date: 2026-07-09
---

# Agent 运行态信号映射（Mobile）

> 接线图 C 固化文档。契约字段 `uiBusy` / `agentBusy` 仅作文档别名；**实现代码保持** `uiRunning`、`agentActive`（及 `isMobileAgentActive()`）。M3 **不重命名** TS 变量/字段。

## 映射表

| 用户可见行为 | 契约字段（文档） | 代码字段 | 数据源 | 禁止 |
|-------------|----------------|---------|--------|------|
| 输入框禁用 / Composer `running` | `uiBusy` | `uiRunning` | `useAgentRunLifecycle().uiRunning` | 用 `agentActive` 代替 |
| 流式横条 / metrics bar | `uiBusy` | `uiRunning` | 同上 + `streamTailGenerating` | — |
| 批量删/压缩/分叉门禁 | `uiBusy` | `uiRunning` | `lifecycle.uiRunning` | 用 `agentActive` 代替 |
| 工具卡「执行中」/ transcript busy | `agentBusy` | `agentActive` | `isMobileAgentActive()` / subscribe | 用 `uiRunning` 代替 |
| 消息 reload 合并（run 中跳全量） | `agentBusy` | `agentActive` | `agentActive` ref | 用 `uiRunning` 代替 |
| 过滤迟到 stream/run 事件 | `activeRunId` | `activeRunId` | `useAgentRunLifecycle` | — |

## `agentActive` 递减（Mobile）

```text
权威路径: useChatStreamRuntime → FINISHED/FAILED + acceptRunEvent → decrementAgentActive
兜底路径: ChatComposer.executeRun.finally → decrementAgentActive（仅 isMobileAgentActive）
幂等: agent-activity.ts refcount ≤0 忽略
```

## Desktop

`agentActive` 仅在 main `handlers/agent.ts` 增减；renderer **不** decrement。

## 消费方审查清单

- Composer / 批量操作 / 压缩 / 分叉 / 回滚 → `uiRunning`（文档 `uiBusy`）
- MessageList / ChatTranscriptWebView `agentRunning` → `agentActive`（文档 `agentBusy`）
- `handleMessagesChanged({ agentRunning })` → 传 `agentActive` ref，非 `uiRunning`
- `useChatTabMessageActions({ agentRunning })` → 传 `lifecycle.uiRunning`（UI 门禁）
