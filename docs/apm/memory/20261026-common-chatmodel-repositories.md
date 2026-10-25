# common / chat model / repositories 整理

日期：2026-10-26

## 结论

`packages/core/src/common`、`domain/chat/model`、`domain/chat/repositories` 完成 34 条清理，核心门禁通过。重点是把 wire 编解码、仓储映射和通用工具收敛到单一入口，删除假公开导出与单点 wrapper。

## 关键决定

- `bytesToBase64` 属于通用工具，已移到 `common/base64.ts` 并从 `common/index.ts` 导出；`rn-file-io.ts` 改为 re-export，`sksp-android` 直接复用。分片大小 0x8000，避免 RN 大字节数组 spread 撑爆调用栈。
- `serializeAttachmentsJson` 只是「空数组 → SQL NULL + JSON.stringify」策略，已内联进 `sqlite-message.repository.ts` 的 `toMessageParams`，删除模块函数、public/chat 转发和 allowlist 条目。
- `parseAttachmentsJson` 保留：它做逐条 safeParse 降级，不是薄 wrapper。
- `serializeComposerDraftJson` 保留：它会过滤非 `attach` 来源、过滤非法 tokenRanges、处理空草稿 NULL，不是单纯 stringify。
- `isComposerDraftAttachment` 保留：parse 与 serialize 两个调用点，内联会重复类型谓词并丢失收窄。
- `public/chat` 撤掉 `DEFAULT_PROJECT_AGENT_CONFIG`、`projectAgentConfigSchema`、`projectAgentModeSchema`、`annotateDraftSchema`、`composerDraftSchema`；模块内仍保留供单测/服务深导入。
- CLI 的 `resolveSeqRange` / floor 改用 `ChatMessageData`，修复 `ChatMessage` → `ChatMessageData` 迁移后的 TS2345。
- `BaseSqliteChatRepository` 与 `infra/tdbc/logic/transaction-helper.ts` 是 workflow 产出的新文件，提交时必须 stage（不能只提交 tracked diff）。

## 验证

- `check-style`（common + chat/model + chat/repositories）：PASS，signatures/inline/methods 0。
- core build 通过；common 33/33；chat 390/390（排除 `usage-stats.service.test.ts`）；package exports 21/21。
- CLI / desktop / mobile / sksp-android typecheck 通过。
- mobile `rn-file-io` 11/11；sksp-android 3/3；webview gate B/C 绿。
- 已知既有红项：`usage-stats.service.test.ts` 2 条 Windows localtime/DST 失败；全量 `check-style --changed` 与 `revision-aware-vfs.service.ts` 的 `_options` eslint 为改动前既有，不属本轮。
