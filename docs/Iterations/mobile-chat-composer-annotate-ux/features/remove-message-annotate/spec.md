---
date: 2026-07-22
agile_trace: true
dependency: Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# remove-message-annotate 实现规格（SPEC）

> 敏捷：`remove-message-annotate`  
> 父迭代：`mobile-chat-composer-annotate-ux`  
> 取代：`features/remove-assistant-message-annotate`

## 根因 / 方案摘要

| 问题 | 方案 |
|------|------|
| 消息批注产品不再需要 | 删除 User+Assistant 消息批注入口、Composer tag、Core 消息草稿/builder |
| 划词仍需复制 | transcript 自建 `menuItems` 仅 `{label:'复制', key:'copy'}`；勿改文件预览常量 |
| 历史伪 path | 保留 `isMessageAnnotatePath`；parse Undo / chip 继续 skip |

## 变更点清单

### Mobile

| 文件 | 变更 |
|------|------|
| `ChatTranscriptWebView.tsx` | 自建仅 copy 的 `CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS`；删 annotate 分支、`onSelectionAnnotate` |
| `ChatTranscriptBridge.ts` | 删 `RESOLVE_SELECTION_ANNOTATE_JS` 与 `selectionAnnotate` 类型 |
| `ChatConversationPanel.tsx` | 删 onSelectionAnnotate / beginMessageAnnotate 接线 |
| `ChatComposer.tsx` | 删 beginMessageAnnotate、消息草稿 modal/store 合并/clear |
| 删 `composer-message-annotate-mention.ts`、`storage/chat-message-annotate-draft.ts` | — |
| `ComposerAtPathInput` / `composer-at-path-mention.ts` | 去掉 `§` trigger / insert / strip；保留 `@path` |

### Core

| 文件 | 变更 |
|------|------|
| `annotate-draft.schema.ts` | 删 `MessageAnnotateDraft` / 判别 helpers；`SendAnnotateDraft = AnnotateDraft`；**保留** `isMessageAnnotatePath` |
| 删 `chat-message-annotate-draft-store.ts` + public 导出 | — |
| `build-attachment-action-xml.ts` | 删消息形 builder；`buildAnnotateAttachmentFromDraft` 仅文件 |

### 测试

- 删 T-MA*（消息发送/mention）；T-UD3 / parse 改为手工伪 path；transcript 测改为仅 copy
- 保留文件批注与 `isMessageAnnotatePath` 相关断言

## 测试策略

- `packages/core`：`annotate-drafts-send`、`parse-annotate-drafts-from-attachments`、package-exports allowlist
- `apps/mobile`：`chat-transcript-selection-annotate`、`composer-at-path`、`use-chat-tab-message-actions-rollback`
- 必要时 `npm run build:webview`（本敏捷未改 web 源码时可跳过）
