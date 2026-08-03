---
date: 2026-07-22
---

# Mobile 聊天 Composer · 批注 · 消息操作 UX 修复 技术规格（SPEC）

## 需求来源

- PRD：`Iterations/mobile-chat-composer-annotate-ux/prd.md`
- 前置合同：`annotate-user-ops-unify`、`composer-at-token-prompt-dedup`、`composer-two-pipelines-hard-contract`、`chat-user-rollback-redo`、`message-set-floor`、`agent-chat-ux-bugfix`
- 探索依据：2026-07-22 四路只读探索
- **修订**：`features/remove-message-annotate`（2026-07-22）——**移除** User+Assistant 消息正文批注全链路；transcript 划词 menu=仅「复制」；**保留**文件批注与 Undo/chip 对历史 `__message__:` 伪 path 的 skip。原 `remove-assistant-message-annotate` 已被该敏捷取代。

## 设计目标

1. **多文件工作区批注下划线**：同会话多 path 草稿切换预览时，当前文件下划线可靠（chip 合同不变）。
2. **`@path` tag 回归**：选择器/typeahead 插入后着色 + 原子删；对外 plain `@路径`；无 attach chip；不露 `{@}` 协议串。
3. **Undo Send 恢复工作区批注**：含 `action:annotate` 且 **真 VFS path** 的 plain user Undo 时，按附件重建 store + chip（及打开文件时下划线）；**跳过** `path.includes('__message__:')` 的伪 path（含 `/__message__:`）。
4. **Composer 选中色柔化**：不再用刺眼 `tokens.primary` 整块选中。
5. **消息菜单右上角主入口**：对齐 Desktop「⋯」；弱化/移除长按主路径；划词复制可用；菜单项集合不变。
6. ~~消息正文批注~~：**已移除**（见 `features/remove-message-annotate`）。

**平台**：仅 Mobile（Android）。Desktop UI 不改、不验收。

## 总体方案

```text
┌─ A. 工作区批注下划线 ─────────────────────────────────────────┐
│ FileMarkdownPreview：path 变化同步派生 pathDrafts（禁滞后一帧） │
│ RichDocumentWebView：setDocument 与 annotations 同批投递；      │
│   建议 key={path} 强制重建；bridge 在文档就绪后 refresh marks   │
└────────────────────────────────────────────────────────────────┘

┌─ B. @path tag + 选中色 ───────────────────────────────────────┐
│ ComposerAtPathInput：取消全程受控 selection（对齐宏输入短暂设） │
│   selectionColor → 柔和 tint；tag 可加轻底与选中区分            │
│ 纯函数/协议（{@}[path](path)）保持；@path 对外仍 @path plain   │
└────────────────────────────────────────────────────────────────┘

┌─ C. Undo → 恢复工作区批注 ────────────────────────────────────┐
│ Core：parseAnnotateDraftsFromAttachments（新 mint id）          │
│   仅真 VFS path；path.includes('__message__:') → 跳过          │
│   （含 /__message__:；历史防御 isMessageAnnotatePath）          │
│ useChatTabMessages：rollback 前 snapshot 附件 → 成功后           │
│   addChatAnnotateDraft* + refreshComposerAnnotateChips          │
│ 与未发送草稿：按条目并存，不静默丢任一侧                        │
└────────────────────────────────────────────────────────────────┘

┌─ D. 消息菜单 ⋯ ───────────────────────────────────────────────┐
│ MessageRow：右上角 ⋯ → openContextMenuFromAnchor(id, btnRect) │
│   （或扩展 MenuAnchor 后等价）；移除/禁用长按主路径              │
│ 平时允许正文划词；菜单项仍 buildMenuItems                        │
│ transcript 划词 menuItems：仅「复制」（自建；勿改文件预览常量） │
└────────────────────────────────────────────────────────────────┘

┌─ E. 消息正文批注 ─────────────────────────────────────────────┐
│ 【已移除 · remove-message-annotate】不再交付 message annotate   │
│ 保留：isMessageAnnotatePath / chip skip / Undo skip 历史伪 path │
└────────────────────────────────────────────────────────────────┘
```

### 钉死决策（含 remove-message-annotate）

| 项 | 定稿 |
|----|------|
| 下划线根因方向 | RN/Web 分发时序 + pathDrafts 异步；优先修投递原子性与同步派生 |
| `@path` 修复方向 | **方案 A**：修正受控 `selection` + 选中色/轻底；不推翻 controlled-mentions |
| Undo 解析 | Core 导出 `parseAnnotateDraftsFromAttachments`；与文件形 `buildAnnotateAttachmentFromDraft` 成对；**新 mint id**；**仅**恢复「真 VFS path」工作区批注 |
| Undo 合并 | 恢复条目 **append** 进现有 store；不按 path 折叠丢条 |
| **Undo / 伪 path 识别** | 用 **`path.includes('__message__:')`**（`isMessageAnnotatePath`）识别历史消息批注伪 path；命中则 **跳过** Undo 恢复与 chip 投影 |
| 长按 | **移除长按打开消息菜单**（主路径）；划词用系统选区；⋯ 为唯一菜单入口 |
| **SendAnnotateDraft** | `SendAnnotateDraft = AnnotateDraft`（仅文件形）；消息形 schema/store/builder **已删** |
| **transcript 划词 menuItems** | **仅「复制」**（`CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS`）；**禁止**改 `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS`（文件预览仍批注+复制）；`copy` → 系统剪贴板 |
| **右上角菜单锚点** | `openContextMenuFromAnchor(messageId, DOMRect)`；⋯ 点击传按钮 rect |
| `hasAnnotateDrafts` | App 侧仅文件 store；不改 Core 布尔语义 |
| Desktop | UI 零改动；文件批注路径继续编译通过 |

## 组件职责（摘要）

| 组件 | 职责 |
|------|------|
| C1–C5 | 多文件下划线、`@path` tag、选中色、⋯ 菜单（既有交付） |
| C6 | Core `parseAnnotateDraftsFromAttachments`：仅真 VFS path；`isMessageAnnotatePath` → 跳过 |
| C7 | Mobile Undo：snapshot → 恢复文件批注 store + chip |
| ~~C9–C11~~ | 消息批注 Core/UI：**已移除**（`remove-message-annotate`） |

## 验收 / 测试要点

- 多文件下划线、`@path` tag、选中色、右上角菜单：沿用父 PRD。
- Undo：真 VFS annotate 恢复；`__message__:` / `/__message__:` **不**进文件 store（T-UD3；手工伪 path）。
- transcript：menuItems 仅 copy；文件预览仍 annotate+copy。
- Core：`buildAnnotateAttachmentFromDraft(AnnotateDraft)` 仅文件；package allowlist 无消息批注导出。

## 风险

| 项 | 说明 | 处理 |
|----|------|------|
| 历史会话含 `__message__:` 附件 | 旧消息仍可能落库伪 path | Undo/chip skip；不提供再编辑入口 |
| 自定义 menu 盖掉原生 Copy | 须自备「复制」 | 已钉死仅 copy menuItems |
