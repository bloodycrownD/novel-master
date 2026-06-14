---
date: 2026-06-15
---

# message-batch-header-use-theme Bug 修复规格（SPEC）

## 根因分析

`ChatConversationPanel` 已从 `ChatTabScreen` 接收 `tokens: ThemeTokens`，但 `MessageBatchHeader` 仍自行调用 `useTheme()`。在部分渲染/热更新路径下 Context 未就绪，触发 `useTheme must be used within ThemeProvider`。

## 修复方案

- `MessageBatchHeader` 增加必填 prop `tokens: ThemeTokens`，删除 `useTheme()`。
- `ChatConversationPanel` 传递 `tokens={tokens}`。
- 单测改为传入 `lightTheme`，移除 ThemeProvider mock。

## 变更点清单

| 文件 | 变更 |
|------|------|
| `MessageBatchHeader.tsx` | tokens prop |
| `ChatConversationPanel.tsx` | 传 tokens |
| `message-batch-header.test.tsx` | lightTheme fixture |
| `user-vfs-action-transcript.tsx`（可选） | 移除 useTheme，用 props |

## 同 commit 附带

- `selectVisibilityBatchEligibleIdsFromAnchor` + `selectRange` 锚点范围全选（前序 UX 需求）

## 测试策略

- mobile `message-batch-header` 2/2
- core `visibility-batch-range` 5/5
- 根 `npm run build`

## 风险与回滚

- 低风险；回滚 commit `fec44f1`。

## 提交

- `fec44f1` fix(mobile): MessageBatchHeader 改用 tokens prop 修复 useTheme 报错
