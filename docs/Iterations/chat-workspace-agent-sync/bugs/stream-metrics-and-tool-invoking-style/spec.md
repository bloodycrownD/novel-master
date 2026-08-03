---
date: 2026-06-13
---

# stream-metrics-and-tool-invoking-style Bug 修复规格（SPEC）

## 根因分析

PRD 将「完全移除 metrics」与「移除 tool 计数」混为一谈，实现时删除了 `useAgentStreamMetrics` 全链路。`ToolTurnPhaseBar` / WebView `tool-invoking-bar` 仅保留纯文本。

## 修复方案

1. 恢复精简版 `useAgentStreamMetrics`（text/thinking + elapsed，无 toolUseChars）
2. `useChatTabStream` 双路 note：metrics + toolInvoking
3. `ChatStreamMetricsBar` 挂回 `ChatMetaBar` 下
4. `ToolTurnPhaseBar`：分隔线 + ActivityIndicator + 主色文案
5. WebView：`.tool-invoking-bar` + 脉冲圆点动画

## 变更点清单

| 文件 | 变更 |
|------|------|
| `useAgentStreamMetrics.ts` | 精简恢复 |
| `ChatStreamMetricsBar.tsx` | 恢复 |
| `useChatTabStream.ts` | 双 hook 接线 |
| `ChatConversationPanel.tsx` | 渲染 metrics |
| `ToolTurnPhaseBar.tsx` | 样式 |
| `transcript-html.ts` / `main.ts` | WebView 样式 |

## 测试策略

- `use-agent-stream-metrics.test.ts`
- 既有 stream/tool invoking 单测
