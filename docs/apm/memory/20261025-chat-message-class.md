# ChatMessage 领域类与逻辑目录类审计

日期：2026-10-25

## 结论

`ChatMessage` 从纯 interface 提升为进程内领域类，持久化/IPC 继续走纯数据；同时清理了逻辑目录里“数据包装类 / 无状态假对象”。

## 模型分层

- `ChatMessageData`：DB row / IPC 的纯数据形状，字段与旧 `ChatMessage` interface 一致；所有仓库、DTO、纯函数入参用它。
- `ChatMessage`：`packages/core/src/domain/chat/logic/message/chat-message.ts`，`private constructor` + `static from(data)`，直接持有消息字段并提供 `hasToolResult` / `isUserInput` / `hasAnnotateAttachment` / `isPlainUserText` / `editableText` / `isUndoSendEligible` / `toolUseCount`。
- `ChatMessageDto`：IPC 形状，不跨进程传 class；桌面 `chatMessageFromDto` 与仓储 `rowToMessage` 在边界 `ChatMessage.from(...)`。
- 删除 `ChatMessageEntity`、`MessageContentEntity`：前者是 `ChatMessage` 的平行 wrapper，后者是 `ChatMessage.content` 字段的平行 wrapper；`toolUseCount` 归 `ChatMessage`，content-only 统计在 usage-stats 内联。
- `public/chat` 同时导出 `ChatMessage` 与 `ChatMessageData`；`ChatMessageEntity` 从 allowlist / metro stale marker / 测试名中移除。

## 逻辑目录类审计

- **有状态**：`ChatAnnotateDraftStore`、`AttachBudget`、`AttachmentHydrator` —— class 合理。
- **无状态领域服务 / codec**：`AttachmentScanner`、`AttachmentXmlCodec`、`PromptAssembler`、`UserMessageFormatter`、`ComposerSendPolicy`、`ChatLinkResolver`、`ForkCopySeeder`、`SkillToolRefResolver`、`DirAttachTreeRenderer`、`UserVfsTurns` —— 保持单例对象/class，但不再新增数据包装层。
- **值对象命名空间**：`attachmentPath`、`promptPathSeen`、`composerAtPath`、`composerChips` 改为 object literal；无实例状态就不 `new`。
- **假对象**：`UserVfsTurnStorage` 只有一个 `wrapActions`，改成 object namespace；`MessageContentEntity` / `ChatMessageEntity` 删除。

## Skill

`nm-code-style` §9.5 新增“数据包装类反模式”：class 只持有一个 DTO/值对象并转发方法时要提升被包装对象或删除 wrapper；子字段不是 Entity；无状态 class 改 namespace。§9.4 迁移顺序与 §9.5 审计四分类同步。

## 验证

- core typecheck / build 通过。
- chat 432 例 430 绿，2 条既有 `usage-stats` DST 失败。
- package-exports 21 绿。
- desktop / mobile typecheck 通过；desktop rollback 3 绿；mobile composer/rollback/message-edit 22 绿。
- webview gate B/C 绿。
- `check-style`（logic + presentation/chat）PASS；`check-signatures` 0；`check-inline` 0；`check-methods` 0；`check-oop` 0 候选。
- 全量 desktop 654 例 651 绿，3 条既有 `renderer` 直连 core 边界测试红（`SettingsViews.tsx`、`renderer/i18n/chat.ts`），与本次 ChatMessage 迁移无关。
