---
date: 2026-07-22
agile_trace: true
dependency: Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# remove-assistant-message-annotate 实现规格（SPEC）

> 敏捷：`remove-assistant-message-annotate`  
> 父迭代：`mobile-chat-composer-annotate-ux`

## 根因 / 方案摘要

| 问题 | 方案 |
|------|------|
| 划词「批注」对全部 `.row.message` 开放 | `RESOLVE_SELECTION_ANNOTATE_JS` 上溯改为 `.row.message.user[data-id]` |
| 宿主仍可能对 assistant id 录入 | `ChatTranscriptWebView` + `ChatConversationPanel` 按 `role === 'user'` 门闩 |
| 希望选区在 assistant 时菜单无「批注」 | RN `menuItems` 静态，低成本做不到 → 保留批注+复制，门闩静默 + 注释说明 |

## 变更点清单

| 文件 | 变更 |
|------|------|
| `ChatTranscriptBridge.ts` | `RESOLVE_SELECTION_ANNOTATE_JS` → `.row.message.user[data-id]` |
| `ChatTranscriptWebView.tsx` | `selectionAnnotate` 后查 `role === 'user'`；注释说明静态 menu |
| `ChatConversationPanel.tsx` | `onSelectionAnnotate` 查 `role === 'user'` 否则 return |
| `__tests__/chat-transcript-selection-annotate.test.ts` | 断言 user 选择器；assistant 不上溯 |
| 父 `prd.md` / `spec.md` | 「助手或用户均可」→「仅用户消息」 |

## 详细改动说明

1. **injectJS**：`el.closest('.row.message.user[data-id]')`；assistant 行 → `messageId === ''` → 宿主既有空 id 取消路径。
2. **WebView 二次门闩**：`prevMessagesRef` 查 id，`role !== 'user'` → return。
3. **Panel 三次门闩**：`chatMessages` 查 id，非 user → 不调 `beginMessageAnnotate`。
4. **不删**：Core message annotate store/builder、`__message__:`、§ tag、文件批注、Undo skip。

## 测试策略

- `apps/mobile`：`npm test -- --testPathPattern="chat-transcript-selection-annotate" --no-coverage`
- 断言：`RESOLVE_SELECTION_ANNOTATE_JS` 含 `.row.message.user[data-id]`，不含旧 `.row.message[data-id]` closest。
