---
date: 2026-07-22
dependency: Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# remove-message-annotate Feature PRD

> 敏捷名称：`remove-message-annotate`  
> 所属迭代：`mobile-chat-composer-annotate-ux`  
> 平台：仅 Mobile；Desktop 无消息批注，勿改。  
> **取代**：`features/remove-assistant-message-annotate`（该敏捷仅收窄为「仅 user」；本期彻底移除 User+Assistant 消息批注）。

## 背景与变更动机

父迭代交付了消息正文划词批注（选区「批注」+ Composer `§` tag + Core `MessageAnnotateDraft` / `__message__:` 落库）。产品确认：**User 与 Assistant 消息批注全部移除**；文件批注保留；transcript 划词菜单只留「复制」。

## 范围说明

| 项 | 说明 |
|----|------|
| **纳入** | 移除消息批注全链路：划词 annotate、Composer tag/store、Core schema/store/builder 消息分支；transcript menuItems 仅「复制」（自建，禁止改 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`） |
| **保留** | 文件批注；`isMessageAnnotatePath` / Undo+chip 对历史 `__message__:` 伪 path 的 skip |
| **不改** | Desktop；文件预览划词「批注」+「复制」 |

## 验收标准

1. **Given** 用户或助手消息正文划词，**When** 看选区菜单，**Then** 仅有「复制」，无「批注」。
2. **Given** 点「复制」，**When** 触发，**Then** 选中片段写入系统剪贴板。
3. **Given** 文件预览划词，**When** 看菜单，**Then** 仍为「批注」+「复制」（`RICH_DOCUMENT_ANNOTATE_MENU_ITEMS` 未改）。
4. **Given** 历史附件 path 含 `__message__:`，**When** Undo Send / 文件批注 chip 投影，**Then** 跳过，不写入文件批注 store/chip。
5. **Given** 仅文件批注草稿，**When** 发送，**Then** 仍走 `AnnotateDraft` / `buildAnnotateAttachmentFromDraft` 进模型。
