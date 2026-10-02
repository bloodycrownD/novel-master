# L0 死导出普查（dead exports）

> 机位：确定性普查（机械事实，不做语义判断）。
> 脚本：`tmp/l0census/dead-exports.mjs`（可复跑：`node tmp/l0census/dead-exports.mjs`）。
> 范围：packages/core/src + apps/{mobile,desktop,cli} 的生产 `.ts/.tsx`（排除 test/__tests__/e2e/spec/dist），共 **1342** 个文件。
> 消费侧：全仓 `packages/` `apps/` `scripts/` `examples/` 的 .ts/.tsx/.js（含测试），按 import 说明符解析到物理文件后计数；沿 barrel `export {} from` / `export * from` 传递消费。

## 本轮重跑（F-synth-dead-1 · 桶定义排除 `relayed`）

> `head_sha`：`d68a848b`（Wave C 末；本轮在其上叠加 Wave D 批次 2 删码）
> 方法：原普查脚本 `tmp/l0census/dead-exports.mjs` 随 `tmp/`（`.gitignore`）丢失，
> 按本文件 §5 的口径**重写等效普查器**（`tmp/l0census/find-relayed3.mjs` + `decomp2.mjs`），
> 只做**定向重分桶**（对既有 §三 表 356 行 core 逐行复核「是否存在生产消费方」），不重跑全表普查。
> 判定式：`relayed` = 该符号沿 `export {} from` 转发链可被 `apps/**` 下的非测试生产文件 import 到。

> **结果**：core §三 由 **356** 行降为 **229** 行，剔除 **127** 行 relayed（与 spec 预期 127/229 完全吻合）；
> 消费方分布 `apps/desktop` 105 / `apps/cli` 15 / `apps/mobile` 7。
> 摘要表「仅被测试消费」相应由 **580** 降为 **453**。

## 摘要

| 指标 | 数量 |
|---|---|
| 生产文件数 | 1342 |
| 命名导出总数（不含 public/barrel 契约面） | 4981 |
| **零消费导出（确认死）** | **1317** |
| 零消费但标 suspect（同名符号出现在解析失败的说明符里） | 26 |
| 仅被测试消费（生产无消费；已排除 relayed，见「本轮重跑」） | **453** |
| public/barrel 契约面导出（单列，不判死） | 1000 |

## 一、零消费导出清单（确认死）

| 文件 | 符号 | 导出类型 | 文件内自用 |
|---|---|---|---|
| `apps/cli/src/cli-errors.ts` | `EXIT_RUNTIME` | const | 是（仅内部用，export 冗余） |
| `apps/cli/src/compaction-conditions/commands.ts` | `CompactionConditionsError` | type | 是（仅内部用，export 冗余） |
| `apps/cli/src/compaction-conditions/commands.ts` | `CompactionConditionsStore` | type | 是（仅内部用，export 冗余） |
| `apps/cli/src/config/build-minimal-definition.ts` | `BuildMinimalDefinitionInput` | interface | 是（仅内部用，export 冗余） |
| `apps/cli/src/config/load-agent-config-file.ts` | `loadAgentConfigFile` | function | 否 |
| `apps/cli/src/runtime.ts` | `resolveDbPath` | function | 是（仅内部用，export 冗余） |
| `apps/cli/src/vfs/errors.ts` | `EXIT_RUNTIME` | const | 是（仅内部用，export 冗余） |
| `apps/cli/src/vfs/errors.ts` | `EXIT_USAGE` | const | 是（仅内部用，export 冗余） |
| `apps/cli/src/vfs/errors.ts` | `exitCodeForError` | function | 否 |
| `apps/cli/src/vfs/errors.ts` | `formatCliError` | function | 否 |
| `apps/cli/src/vfs/parse-args.ts` | `ParsedCliArgs` | interface | 是（仅内部用，export 冗余） |
| `apps/cli/src/vfs/runtime.ts` | `createVfsRuntime` | function | 否 |
| `apps/cli/src/vfs/runtime.ts` | `resolveDbPath` | reexport | 否 |
| `apps/cli/src/workplace/run-workplace.ts` | `WorkplaceDisplayAssembleContext` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/batch/ManageHeader.tsx` | `ManageHeaderBatchAction` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `mermaidCacheKey` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `MermaidFenceScan` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `MermaidMarkdownProps` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `MermaidSvgRenderer` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `MermaidTheme` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/ui/show-toast.ts` | `subscribeToast` | reexport | 否 |
| `apps/desktop/renderer/components/ui/show-toast.ts` | `ToastOptions` | reexport | 否 |
| `apps/desktop/renderer/components/ui/toast-bus.ts` | `ToastOptions` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_FAILED_MESSAGE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_RESULT_TITLE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_UP_TO_DATE_MESSAGE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/AtPathTypeahead.tsx` | `AtPathTypeaheadProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx` | `AttachmentDraftChips` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx` | `AttachmentDraftChipsProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-annotate-draft.ts` | `AnnotateDraft` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-annotate-draft.ts` | `removeChatAnnotateDraftsByPath` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-link-route.ts` | `ChatLinkAction` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-link-route.ts` | `ChatLinkLogger` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-link-route.ts` | `ChatLinkSessionContext` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/chat-messages-scroll.ts` | `NEAR_BOTTOM_THRESHOLD_PX` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/composer-send-intent.ts` | `ComposerSendIntent` | reexport | 否 |
| `apps/desktop/renderer/features/chat/composer-send-intent.ts` | `ComposerSendIntentAttachment` | reexport | 否 |
| `apps/desktop/renderer/features/chat/composer-send-intent.ts` | `ComposerSendIntentInput` | reexport | 否 |
| `apps/desktop/renderer/features/chat/composer-send-state.ts` | `ComposerSendState` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/ComposerAtPathInput.tsx` | `ComposerAtPathInputProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/conversation-abort-retain.ts` | `commitAbortOverlayFallbackIfNeeded` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/conversation-batch.ts` | `ConversationBatchSink` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/conversation-batch.ts` | `UseConversationBatchOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/FileReferencePicker.tsx` | `FileReferencePickerProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `BuildChatListItemsOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `buildToolResultByUseId` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `ChatListItem` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `MessageListItem` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `ToolCallStatus` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `toolCallViewFromUse` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `toolUseIdsFromMessage` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `turnToolResultsComplete` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/message-edit.ts` | `applyTextEditToContentBlocks` | function | 否 |
| `apps/desktop/renderer/features/chat/message-edit.ts` | `MessageActionMenuItem` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/MessageAttachmentGroupCard.tsx` | `MessageAttachmentGroupCardProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx` | `MetricsDetailPanel` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx` | `useSessionUsageDetail` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/readOnlyRunProbeLogic.ts` | `ProbeReadOnlyRunEndedParams` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/rollback-composer.ts` | `ComposerDraftSnapshot` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/rollback-composer.ts` | `resolveComposerTextAfterRollbackSuccess` | function | 否 |
| `apps/desktop/renderer/features/chat/SkillTypeahead.tsx` | `SkillTypeaheadProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | `deleteToolTurn` | function | 否 |
| `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | `hideToolTurn` | function | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `buildTailBatchRows` | function | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `computeHideRangeFromSelection` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `computeShowRangeFromSelection` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `computeTailBatchAffectedIds` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `computeTailBatchRangeFromSelection` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `computeVisibilityBatchAffectedIds` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `isTailBatchRowSelectable` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `isTranscriptRowSelectable` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `MessageBatchMode` | type | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `MessageVisibilityBatchMode` | type | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `selectTailBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `selectVisibilityBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `tailBatchDeleteAfterSeq` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `TailBatchMode` | type | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `TailBatchRow` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `transcriptSelectableRole` | reexport | 否 |
| `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `TranscriptSelectableRole` | type | 否 |
| `apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts` | `READONLY_RUN_PROBE_INTERVAL_MS` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts` | `UseReadOnlyRunProbeParams` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | `AgentDefinitionBuildResult` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | `AgentDefinitionEditorForm` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | `AgentDefinitionEditorFormHandle` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | `AgentDefinitionEditorFormProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/migration-row-value.ts` | `MigrationRowValue` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/prompt-macro-input.ts` | `findWhitelistMacroRanges` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/prompt-macro-input.ts` | `PromptInsertableMacro` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/prompt-macro-input.ts` | `WhitelistMacroRange` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/PromptMacroChips.tsx` | `PromptMacroChipsProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/PromptMacroTextarea.tsx` | `PromptMacroTextareaProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/settings-nav.ts` | `SettingsNavGuardInput` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/settings/settings-ui.tsx` | `SettingsToolbar` | function | 否 |
| `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx` | `usePickerData` | function | 否 |
| `apps/desktop/renderer/features/skills/SkillPicker.tsx` | `SkillPickerProps` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | `usePreviewSelection` | function | 否 |
| `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | `useTreeLoader` | function | 否 |
| `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | `useTreeRefreshToken` | function | 否 |
| `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts` | `hasFileDrag` | function | 否 |
| `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts` | `hasNmVfsMime` | function | 否 |
| `apps/desktop/renderer/features/workspace/vfs-tree-dnd.ts` | `VfsDragPayload` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts` | `isDescendantPath` | function | 否 |
| `apps/desktop/renderer/features/workspace/workspace-actions.ts` | `setDirRuleEnabled` | function | 否 |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `ActiveNativeDrag` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `clearActiveNativeDrag` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `formatBatchApplyToast` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `getActiveNativeDrag` | function | 否 |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `handleFilesDropIngest` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `isPrefetchInFlightForTest` | function | 否 |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `releaseStagedExport` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `StagedExport` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | `PENDING_RUN_ID` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | `shouldAcceptRunEvent` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | `shouldIgnoreStaleRunStarted` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | `shouldReloadTranscriptOnRunEvent` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentStream.ts` | `UseAgentStreamOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentStream.ts` | `UseAgentStreamResult` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` | `AgentStreamEstimatorFactory` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` | `AgentStreamMetricsSnapshot` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` | `AgentStreamTokenSource` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | `StreamTailGenerating` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | `useStreamTailGenerating` | function | 否 |
| `apps/desktop/renderer/ipc/invoke-registry.ts` | `InvokeFn` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/AppMenuBar.tsx` | `AppMenuBar` | function | 否 |
| `apps/desktop/renderer/layout/ExplorerPane.tsx` | `WorkspaceContextTarget` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `buildFlatTextIndex` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `estimateSoftRangeForPreviewSelection` | function | 否 |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `findAllOccurrences` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `mapFlatRangeToSegments` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `normalizeAnnotateNeedle` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PreviewAnnotateCollectResult` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PreviewAnnotateDraftInput` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `readSelectionNeighborhood` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `sortAnnotateTextsLongestFirst` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-recogito.ts` | `RecogitoRenderRange` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-utils.ts` | `isLikelyMarkdownContent` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/layout/preview-utils.ts` | `isMarkdownPreviewPath` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/providers/NovelMasterProvider.tsx` | `NovelMasterContextValue` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/providers/NovelMasterProvider.tsx` | `RuntimeStatus` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/providers/ShellNavProvider.tsx` | `ShellNavContextValue` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/providers/ThemeProvider.tsx` | `ThemeContextValue` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/providers/ThemeProvider.tsx` | `ThemeMode` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/state/desktop-scope.ts` | `DesktopScopeSnapshot` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/state/nav-workspace.ts` | `NAV_TO_WORKSPACE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/state/nav-workspace.ts` | `WORKSPACE_TITLES` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/renderer/utils/session-default-title.ts` | `DEFAULT_SESSION_TITLE_PREFIX` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/scripts/after-pack.mjs` | `afterPack` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/scripts/fix-settings-utf8.mjs` | `EventsConfigView` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `AgentPickerRowDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `AnnotateDraftDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `AppGetInfoData` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `BlobBinaryTableIdDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `BlobBinaryTableStatusDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `BootstrapStatusFailed` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `BootstrapStatusReady` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `CloudSyncSetEnabledRequest` | type | 否 |
| `apps/desktop/shared/ipc-types.ts` | `MessageAttachmentActionDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `MessageMetadataDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `ModelPickerRowDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `ProjectAgentModeDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `SearchEngineStatusDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `SessionUsageLastRequestDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `SmartSortRuleBundleRuleDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `SmartSortRuleMatchDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `StoredConfigInvalidDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `UpdateCheckStatus` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `VfsBatchConflictDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `WorkplaceDisplayState` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `WorkplaceInclusionMode` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/ipc-types.ts` | `WorkplaceRuleState` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/shared/logic/chat.ts` | `AnnotateQuoteContext` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `AnnotateSoftRangeFields` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `AnnotateSourceMatch` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `AnnotateSourceMatchStrategy` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `applySoftRangeLinePadding` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `BuildAnnotatedSourceInput` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `BuildAnnotatedSourceMode` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `BuildAnnotatedSourceResult` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `ComposerSendIntent` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `ComposerSendIntentAttachment` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `ComposerSendIntentInput` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `computeHideRangeFromSelection` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `computeShowRangeFromSelection` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `computeTailBatchAffectedIds` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `computeTailBatchRangeFromSelection` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `computeVisibilityBatchAffectedIds` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `countAnnotateOccurrencesInSource` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `estimateSoftRangeFromOriginalText` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `estimateSoftRangeFromPlainOffsets` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `expandSoftRangeOnce` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `FlatSegmentLocalRange` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `FlatTextIndex` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `FlatTextSegmentSpan` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `hasToolResult` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `hasValidAnnotateOffsetRange` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `isComposerStatusAttachment` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `isTailBatchRowSelectable` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `isTranscriptRowSelectable` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `MessageVisibilityBatchMode` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `normalizeAnnotateNeedleStripNewlines` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `normalizeAnnotateSegmentText` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `offsetToSourceLineCol` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `selectTailBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `selectVisibilityBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `sliceSourceBySoftRange` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `splitSourceLines` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `tailBatchDeleteAfterSeq` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `TailBatchMode` | type | 否 |
| `apps/desktop/shared/logic/chat.ts` | `transcriptSelectableRole` | reexport | 否 |
| `apps/desktop/shared/logic/chat.ts` | `TranscriptSelectableRole` | type | 否 |
| `apps/desktop/shared/logic/config-forms-agent.ts` | `DEFAULT_WORKPLACE_ASSISTANT_TEXT` | reexport | 否 |
| `apps/desktop/shared/logic/config-forms-stored-config-validity.ts` | `StoredConfigHealth` | type | 否 |
| `apps/desktop/shared/logic/format.ts` | `SLIDING_TOKEN_RATE_WINDOW_MS` | reexport | 否 |
| `apps/desktop/shared/logic/format.ts` | `slidingTokenRate` | reexport | 否 |
| `apps/desktop/shared/logic/format.ts` | `TokenRateSample` | reexport | 否 |
| `apps/desktop/shared/logic/skills.ts` | `SkillFrontMatterValues` | type | 否 |
| `apps/desktop/shared/logic/smart-sort.ts` | `SmartSortHighlightSegment` | type | 否 |
| `apps/desktop/shared/logic/vfs.ts` | `VfsEntryNameValidation` | type | 否 |
| `apps/desktop/src/main/ipc/forward-agent-activity.ts` | `detachAgentActivityForwarder` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/ipc/handler-registry.ts` | `registerHandlersFromRegistry` | function | 否 |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `__testRunTrackingState` | function | 否 |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `abortAgentRun` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/runtime/register-platform-drivers.ts` | `PlatformSkspName` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/agent-run.service.ts` | `AgentRunError` | reexport | 否 |
| `apps/desktop/src/main/services/agent-run.service.ts` | `AgentRunScope` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/agent-yaml.service.ts` | `decodeAgentYamlText` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/agent-yaml.service.ts` | `encodeAgentYamlText` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_ACCESS_KEY_ID` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_BUCKET` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_DEVICE_ID` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_DEVICE_LABEL` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_ENABLED` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_ENDPOINT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_FORCE_PATH_STYLE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_LAST_PULL_AT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_LAST_PULL_RESULT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_LAST_PUSH_AT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_LAST_PUSH_RESULT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_LAST_SYNCED_REV` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_PATH_PREFIX` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KEY_REGION` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KKV_MODULE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_SKSP_SECRET_REF` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `CloudSyncPublicConfig` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync-config.store.ts` | `DEFAULT_CLOUD_SYNC_PATH_PREFIX` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync.service.ts` | `CloudSyncLocalStatusDto` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/cloud-sync.service.ts` | `DesktopCloudSyncService` | class | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/prompt-preview.service.ts` | `PromptPreviewScope` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/session-prompt-input.service.ts` | `BuildSessionPromptInputOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/session-prompt-input.service.ts` | `SessionPromptInputBundle` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/update-check.service.ts` | `runUpdateCheck` | function | 否 |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `BatchIngestFromPathsOutcome` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `collectHostPathEntries` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `ExportStageResult` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `hostRelativePathForTest` | function | 否 |
| `apps/desktop/src/main/services/vfs-operations.service.ts` | `createVfsDirectory` | function | 否 |
| `apps/desktop/src/main/services/vfs-operations.service.ts` | `createVfsFile` | function | 否 |
| `apps/desktop/src/main/services/vfs-operations.service.ts` | `remapPathUnderDir` | reexport | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/vfs-operations.service.ts` | `VfsListEntry` | type | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/services/vfs-zip.service.ts` | `zipBaseNameFromPath` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/shell-menu.ts` | `buildApplicationMenu` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_DEFAULTS` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_CHAT_RICH_TEXT` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_AUTO_CHECK` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_DISMISSED_VERSION` | const | 否 |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_LAST_CHECK_AT` | const | 否 |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION` | const | 否 |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_LAST_CHECK_STATUS` | const | 否 |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL` | const | 否 |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DESKTOP_UI_KKV_MODULE` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/storage/app-ui-prefs.ts` | `DesktopAppUiPreferences` | interface | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/update-check/app-meta.ts` | `GITHUB_REPO` | const | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/update-check/app-meta.ts` | `githubReleasesUrl` | function | 否 |
| `apps/desktop/src/main/update-check/app-meta.ts` | `githubRepoUrl` | function | 是（仅内部用，export 冗余） |
| `apps/desktop/src/main/update-check/app-meta.ts` | `licenseUrl` | function | 否 |
| `apps/desktop/src/main/update-check/resolve-latest-release.ts` | `resolveLatestReleaseFromList` | function | 否 |
| `apps/desktop/src/main/update-check/types.ts` | `UpdateCheckStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts` | `AgentEditorFormStateApi` | type | 否 |
| `apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts` | `InvalidAgentConfig` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts` | `SavedModelEntry` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/agent-editor/useAgentEditorFormState.ts` | `SavedProviderOption` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/prompt-macro-input.ts` | `PromptInsertableMacro` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/prompt-macro-input.ts` | `PromptMacroSegment` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/agent/prompt-macro-input.ts` | `WhitelistMacroRange` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/batch/ListBatchBar.tsx` | `ListBatchBar` | function | 否 |
| `apps/mobile/src/components/batch/ManageHeader.tsx` | `ManageHeaderBatchAction` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/charts/PieChart.tsx` | `pieChartColors` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/charts/PieChart.tsx` | `PieChartDatum` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/charts/StackedBars.tsx` | `StackedBarsDatum` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/AtPathTypeahead.tsx` | `AtPathTypeaheadProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/AttachmentDraftChips.tsx` | `AttachmentDraftChips` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/AttachmentDraftChips.tsx` | `AttachmentDraftChipsProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `BridgeEnvelope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `HostToTranscriptType` | type | 否 |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `TranscriptAttachmentView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `TranscriptToHostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `TranscriptToHostType` | type | 否 |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `TranscriptToolView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | `CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | `ChatTranscriptWebViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/composer-highlight.ts` | `ComposerSegment` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/composer-highlight.ts` | `ComposerTokenRange` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/composer-send-state.ts` | `ComposerSendState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ComposerAtPathInput.tsx` | `ComposerAtPathInputProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `BridgeEnvelope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `ComposerInputSetTextPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `ComposerInputToHostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/ComposerInputWebView.tsx` | `ComposerInputWebViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/FileReferencePicker.tsx` | `FileReferencePickerProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/FileReferencePicker.tsx` | `listPickerDirectoryChildRows` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/flush-run-ui.ts` | `FlushMessagesChanged` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/flush-run-ui.ts` | `FlushStreamEndContext` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/message-blocks.ts` | `MessageListItem` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/message-blocks.ts` | `ToolCallStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/message-blocks.ts` | `ToolPairingContext` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/message-blocks.ts` | `TranscriptStreamState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/MessageActionMenu.tsx` | `MessageActionMenuItem` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/SkillTypeahead.tsx` | `SkillTypeaheadProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/tool-turn-actions.ts` | `MessageRuntime` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `chatMessagesToTailBatchRows` | function | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `computeHideRangeFromSelection` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `computeShowRangeFromSelection` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `computeTailBatchAffectedIds` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `computeTailBatchRangeFromSelection` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `computeVisibilityBatchAffectedIds` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `isTailBatchMode` | function | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `isTailBatchRowSelectable` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `isTranscriptRowSelectable` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `MessageBatchMode` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `MessageVisibilityBatchMode` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `selectTailBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `selectVisibilityBatchEligibleIdsFromAnchor` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `tailBatchDeleteAfterSeq` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `TailBatchRow` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `transcriptSelectableRole` | reexport | 否 |
| `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `TranscriptSelectableRole` | type | 否 |
| `apps/mobile/src/components/chrome/EditorScreenShell.tsx` | `EditorScreenShellProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/chrome/ToastHost.tsx` | `ToastOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/form/FormChipGroup.tsx` | `ChipOption` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/form/FormSelectField.tsx` | `SelectOption` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/icons/TabIcons.tsx` | `AgentTabIcon` | function | 否 |
| `apps/mobile/src/components/icons/TabIcons.tsx` | `ManageListIcon` | function | 否 |
| `apps/mobile/src/components/icons/TabIcons.tsx` | `ZipExportIcon` | function | 否 |
| `apps/mobile/src/components/icons/TabIcons.tsx` | `ZipImportIcon` | function | 否 |
| `apps/mobile/src/components/profile/ProfileStatusCard.tsx` | `ProfileStatusMetric` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx` | `PromptPreviewSegmentView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/provider/ModelPickerModal.tsx` | `SavedModelRow` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/rich-content/decode-literal-html-entities.ts` | `DecodeLiteralHtmlEntitiesOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/rich-content/highlight-code.ts` | `registerHighlightLanguages` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/rich-content/RichContentBody.tsx` | `RichContentBodyProps` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/skills/NewSkillModal.tsx` | `NewSkillTarget` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/skills/skill-ui.ts` | `skillDomainHintLabel` | function | 否 |
| `apps/mobile/src/components/skills/SkillPicker.tsx` | `SkillPickerProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/ui/CollapsibleCard.tsx` | `CollapsibleCardProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/ui/ModalShell.tsx` | `ModalShellKeyboardAvoid` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/ui/ModalShell.tsx` | `ModalShellVariant` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/ui/PickerListModal.tsx` | `PickerRowProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/ui/TextPromptModal.tsx` | `PromptField` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_FAILED_MESSAGE` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_RESULT_TITLE` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | `UPDATE_CHECK_UP_TO_DATE_MESSAGE` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | `UpdateCheckResultKind` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/build-front-matter-document-html.ts` | `FrontMatterDocumentInput` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/CodeEditorBridge.ts` | `BridgeEnvelope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/CodeEditorBridge.ts` | `CodeEditorToHostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/CodeEditorWebView.tsx` | `CodeEditorWebViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/file-annotate-gate.ts` | `FileAnnotateScopeKind` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/FileMarkdownPreview.tsx` | `pathDraftsToRecogitoMarks` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/front-matter-fields.ts` | `FrontMatterField` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `BridgeEnvelope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `RichDocumentSelectionCollectPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `RichDocumentSetPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `RichDocumentToHostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/RichDocumentWebView.tsx` | `RichDocumentWebViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/vfs-direct-children-order.ts` | `OrderedDirectChildPathsParams` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/vfs-row-mapper.ts` | `dirRuleBadge` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/vfs-row-mapper.ts` | `entryName` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/vfs-row-mapper.ts` | `VfsBadgeTone` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/vfs-row-mapper.ts` | `VfsRowBadge` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/VfsFileManager.tsx` | `VfsFileManagerProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/VfsFileManager.tsx` | `VfsFileManagerPullScope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/components/vfs/VfsFileManager.tsx` | `VfsFileManagerPushScope` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/db/connection.ts` | `getMobileDatabaseFilePath` | reexport | 否 |
| `apps/mobile/src/db/connection.ts` | `probeAndCacheMobileDatabaseFilePath` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useAdaptiveKeyboardSheetStyle.ts` | `Options` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useAgentStreamMetrics.ts` | `AgentStreamMetricsSnapshot` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useAgentStreamMetrics.ts` | `AgentStreamTokenSource` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useAutoUpdateCheck.ts` | `AutoUpdateCheckController` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useAutoUpdateCheck.ts` | `AutoUpdateCheckUi` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useBatchDeleteConfirm.ts` | `BatchDeleteConfirmOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useFocusListReload.ts` | `FocusListReloadResult` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useFocusListReload.ts` | `UseFocusListReloadOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useStreamTailGenerating.ts` | `StreamTailGenerating` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/hooks/useStreamTailGenerating.ts` | `useStreamTailGenerating` | function | 否 |
| `apps/mobile/src/navigation/header-config.ts` | `PageHeaderConfig` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/navigation/main-tab-bar-style.ts` | `TabBarInsets` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/runtime/novel-master-context.tsx` | `NovelMasterContextValue` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/runtime/novel-master-context.tsx` | `RuntimeStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/stack/token-usage/format.ts` | `MS_PER_DAY` | const | 否 |
| `apps/mobile/src/screens/tabs/chat-tab/chat-link-nav.ts` | `ChatLinkOpenIntent` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx` | `ChatConversationPanelProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx` | `ChatSessionListPanelProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/ChatTabNavigationProvider.tsx` | `ChatTabNavigationProviderProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx` | `ChatTabContextValue` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabController.ts` | `ChatTabController` | type | 否 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessageActions.ts` | `UseChatTabMessageActionsParams` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | `UseChatTabMessagesParams` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts` | `UseChatTabMessagesResult` | type | 否 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` | `UseChatTabScopeParams` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts` | `UseChatTabScopeResult` | type | 否 |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabStream.ts` | `UseChatTabScrollCacheParams` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatTabStream.ts` | `UseChatTabScrollCacheResult` | type | 否 |
| `apps/mobile/src/screens/tabs/chat-tab/useInterruptedPartialCommit.ts` | `UseInterruptedPartialCommitOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/agent-finished-notification.ts` | `AgentKeepAliveLabel` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/agent-finished-notification.ts` | `isAppInForeground` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/agent-run.service.ts` | `resolveCurrentAgentDefinition` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/agent-run.service.ts` | `resolveMobileSavedModelId` | function | 否 |
| `apps/mobile/src/services/agent-yaml.service.ts` | `encodeAgentYamlText` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/chat-agent-meta.ts` | `ChatAgentModelSource` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/chat-list-scroll-cache.ts` | `clearScrollSnapshot` | function | 否 |
| `apps/mobile/src/services/chat-session-view-cache.ts` | `SessionViewCache` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/chat-transcript-scroll-cache.ts` | `clearTranscriptScrollSnapshot` | function | 否 |
| `apps/mobile/src/services/chat-transcript-scroll-cache.ts` | `LegacyChatListScrollSnapshot` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/chat-transcript-telemetry.ts` | `ChatTranscriptTelemetryEvent` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync-progress-log.ts` | `CloudSyncProgress` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync-progress-log.ts` | `CloudSyncProgressOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncConfigPublic` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncLocalStatus` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncProgressListener` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncPullOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncPullOutcome` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncPushOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/cloud-sync.service.ts` | `CloudSyncStatusView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/compaction-warm-orchestration.service.ts` | `RunCompactionWithTokenWarmHooks` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/compaction-warm-orchestration.service.ts` | `RunCompactionWithTokenWarmOutcome` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/db-maintenance.service.ts` | `isMobileDbMaintenanceBusy` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/document-io.ts` | `ExportViaPickerOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/document-io.ts` | `PickAndReadOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/document-io.ts` | `PickedLocalFile` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/document-io.ts` | `PickLocalFileOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | `FetchLike` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/prompt-preview.service.ts` | `PromptPreviewScope` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/run-finish-calibration-probe.ts` | `RunFinishCalibrationProbeParams` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/run-state-writethrough.ts` | `RUN_STATE_WRITETHROUGH_LARGE_PAYLOAD_CHARS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/run-state-writethrough.ts` | `RunStateWritethroughWriteFn` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/scope-key-cache.ts` | `ScopeKeyCache` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/search-config.store.ts` | `EngineId` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/search-config.store.ts` | `KEY_ENGINE_IDS` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/search-config.store.ts` | `KeyEngineId` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/search-config.store.ts` | `SearchConfigPublic` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/search-config.store.ts` | `SearchConfigStore` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-messages-loader.ts` | `loadSessionMessages` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-messages-loader.ts` | `loadSessionMessagesPage` | function | 否 |
| `apps/mobile/src/services/session-messages-loader.ts` | `loadSessionMessagesTail` | function | 否 |
| `apps/mobile/src/services/session-prompt-input.service.ts` | `BuildSessionPromptInputOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-prompt-input.service.ts` | `SessionPromptInputBundle` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamManagerRuntime` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamScopeBridge` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamSettledProjection` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamStartOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamStartResult` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamUiBridge` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamUnitManagerParams` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamMessageStore` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamUnitActiveStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamUnitOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamUnitSettledStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamUnitStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/session-stream-unit.ts` | `SessionStreamUnitTokenSource` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/stream-apply-buffer.ts` | `StreamApplyBufferOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/stream-token-estimator.ts` | `resolveStreamTokenVendorModelId` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/stream-token-estimator.ts` | `StreamTokenEncodingName` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/user-vfs-turn-execute.service.ts` | `isSessionVfsScope` | function | 否 |
| `apps/mobile/src/services/vfs-operations.service.ts` | `deleteVfsEntry` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/vfs-operations.service.ts` | `sessionDeleteVfsEntry` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/vfs-operations.service.ts` | `VfsListEntry` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/workplace-block.service.ts` | `assembleWorkplaceForMobile` | function | 否 |
| `apps/mobile/src/services/workplace-block.service.ts` | `SessionWorkplaceBlockScope` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/services/workplace-operations.service.ts` | `batchSetDirRulesEnabled` | function | 否 |
| `apps/mobile/src/services/workplace-operations.service.ts` | `setDirRuleEnabled` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/shims/aws-rn-s3-client.ts` | `createRnS3ClientConfig` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/storage/chat-composer-draft.ts` | `ChatComposerDraft` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/storage/update-prefs.ts` | `readLastCheckAt` | function | 否 |
| `apps/mobile/src/theme/ThemeProvider.tsx` | `ThemeContextValue` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/update-check/app-meta.ts` | `githubReleasesUrl` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/update-check/app-meta.ts` | `githubRepoUrl` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/update-check/app-meta.ts` | `licenseUrl` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/update-check/types.ts` | `UpdateCheckStatus` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/utils/session-default-title.ts` | `DEFAULT_SESSION_TITLE_PREFIX` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/vfs/errors.ts` | `formatError` | reexport | 否 |
| `apps/mobile/src/web/chat-transcript/stream/block-split.ts` | `StreamBlockSplit` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/main.ts` | `bootTranscript` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/boot/boot-transcript.ts` | `bindHostMessageEvents` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/boot/boot-transcript.ts` | `bootTranscript` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts` | `applyHostTheme` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts` | `HostTheme` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `attachMenuNativeTextBlock` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `buildMenuItems` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `detachMenuNativeTextBlock` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `findMessageRow` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `handleMenuOverlayEvent` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `invokeRegisteredRenderContextMenu` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `MenuOverlayViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `renderContextMenu` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `RenderContextMenuView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `suppressNativeTextMenu` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `viewportHeight` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/mermaid.ts` | `cancelPendingMermaidScanForTests` | function | 否 |
| `apps/mobile/src/web/chat-transcript/webview/runtime/mermaid.ts` | `runMermaidScan` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-logic.ts` | `invokeRegisteredRenderRows` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-logic.ts` | `RenderRowsView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `desiredRowWindow` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `getRowWindowAvgSlotPx` | function | 否 |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `planRowWindowMove` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `retargetRowWindow` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `ROW_WINDOW_BUFFER_ROWS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `ROW_WINDOW_ROWS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts` | `RowWindowRange` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | `applySnapshot` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | `promoteStreamTailToRow` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | `RestoreScroll` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | `RowsPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts` | `SnapshotPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts` | `summarizeToolInput` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts` | `clampScrollTop` | function | 否 |
| `apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts` | `SCROLL_TOP_LOAD_OLDER` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts` | `scrollTimer` | let | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts` | `ContextMenuState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts` | `StreamState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts` | `TranscriptState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `flushStreamRichUpgrade` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `paintStreamRichKind` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `renderStreamingInline` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `renderStreamingMarkdown` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `STREAM_RICH_UPGRADE_MS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `StreamRichUpgradeState` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `appendEscapedDelta` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `appendStreamDeltaIncremental` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `getStreamActiveTailEl` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `StreamBatchPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `StreamBlockCommitPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `streamHasContent` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `streamRichDomReady` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `StreamTailPhase` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `updateStreamBubble` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/util/skill-tool-ref.ts` | `resolveSkillToolRefFromInput` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts` | `normalizePathForToolCard` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts` | `resolveLogicalPathForToolCard` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts` | `resolveVfsToolFilePath` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/menu/ContextMenu.tsx` | `ContextMenuProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/menu/MenuOverlay.tsx` | `MenuOverlayProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/AssistantBubble.tsx` | `AssistantBubbleInnerProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/AttachGroup.tsx` | `AttachGroupProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/CollapsibleSection.tsx` | `CollapsibleHeaderProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/CollapsibleSection.tsx` | `CollapsibleSectionProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/MessageRow.tsx` | `MessageRowProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/ThinkingSection.tsx` | `ThinkingSectionProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx` | `ToolGroupProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/code-editor/webview/runtime/bridge.ts` | `post` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/code-editor/webview/runtime/composer-tokens.ts` | `COMPOSER_TOKEN_PATH` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/code-editor/webview/runtime/editor.ts` | `destroyEditor` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/code-editor/webview/runtime/editor.ts` | `EditorSelectionRange` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `applyMetrics` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `applyMode` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `applyPlaceholder` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `destroyComposerEditor` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `ComposerInputToHostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `ComposerInputToHostType` | type | 否 |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `ComposerSelectionPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `HostToComposerInputMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `HostToComposerInputType` | type | 否 |
| `apps/mobile/src/web/composer-input/webview/runtime/model.ts` | `SetTextPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts` | `AnnotateCollectMode` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts` | `AnnotateSelectionCollectPayload` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-recogito-map.ts` | `RecogitoRenderDraft` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | `HostTheme` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | `invokeRegisteredSetDocumentView` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | `setDocument` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | `SetDocumentView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/document-model.ts` | `DocumentBody` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/rich-document/webview/runtime/document-model.ts` | `HostTheme` | type | 否 |
| `apps/mobile/src/web/rich-document/webview/ui/DocumentApp.tsx` | `DocumentAppProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/constants.ts` | `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` | const | 否 |
| `apps/mobile/src/web/shared/decode-entities.ts` | `DecodeLiteralHtmlEntitiesOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/host-message-channel.ts` | `HostMessage` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/host-message-channel.ts` | `HostMessageHandler` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/host-theme.ts` | `ApplyHostThemeOptions` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `loadMermaid` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `MermaidSourceCache` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `MermaidTheme` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `nextMermaidId` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `readMermaidThemeFromDocument` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `RenderMermaidCodeBlocksOptions` | interface | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `renderMermaidSvg` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts` | `MERMAID_FULLSCREEN_CSS` | const | 否 |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `isMermaidViewerOpen` | function | 否 |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `MermaidViewerPost` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `MermaidViewerViewProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `openMermaidViewer` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `registerMermaidViewerView` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `RenderMermaidViewerView` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `MERMAID_DOUBLE_TAP_INTERVAL_MS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `MermaidViewerDoubleTap` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `MermaidViewerTransform` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/mermaid-fullscreen/MermaidViewerOverlay.tsx` | `MermaidViewerOverlayProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/post.ts` | `BoundPost` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/post.ts` | `post` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/post.ts` | `ReactNativeWebViewBridge` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/theme-mode.ts` | `ThemeMode` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/web/shared/ui/TrustedHtml.tsx` | `TrustedHtmlProps` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_CHAR_WIDTH_EST` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_GAP` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_H_PADDING` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_ITEM_LAYOUT_HEIGHT` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_MAX_HEIGHT_CAP` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_MAX_WIDTH` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_MIN_WIDTH` | reexport | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT` | reexport | 否 |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `anchoredMenuMaxHeight` | function | 是（仅内部用，export 冗余） |
| `apps/mobile/src/webview-host/chat-transcript/anchored-menu-layout.ts` | `MESSAGE_ACTION_MENU_ITEM_COUNT` | reexport | 否 |
| `apps/mobile/src/webview-host/webview-asset-uri.ts` | `WebViewAssetPackageId` | type | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/core-shim.ts` | `AgentDefinition` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `AgentError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `AgentRunResolveError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `AgentRunResult` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `AgentTurnError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `buildToolResultBlock` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `buildUserVfsTurnView` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `buildVfsZip` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ChatAgentSession` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ChatError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `CloudSyncCoordinator` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `CloudSyncError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `createAgentRunner` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `createVfsZipIoService` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `DEFAULT_WORKPLACE_DIR_RULE` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `deriveToolUsesFromVfsActions` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ENGINE_IDS` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `formatUserVfsTurnPreviewBody` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `isCloudSyncError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `isUserVfsUnifiedToolTurnEnabled` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `isVfsError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `KEY_ENGINE_IDS` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `KkvError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `KkvService` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `matchDepth` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `matchUserVfsTurnAt` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `messageBodyText` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `normalizePrefix` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `parseAllUserVfsActionsFromText` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `parseCloudSyncStatus` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ParsedUserVfsAction` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ParsedUserVfsEditHunk` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `parseVfsZip` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ProviderError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `registerBuiltinTools` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `resolveAgentToolRegistry` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `resolveApplicationModelIdForRun` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `resolveCurrentAgentDefinition` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `resolveCurrentAgentId` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `resolveToolResultOk` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `runAgentTurn` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `sortDirPaths` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `sortFilesForDir` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `statusKey` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `TdbcError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `textBlocks` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ToolError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `ToolRegistry` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `USER_VFS_TURN_ACK_TEXT` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `USER_VFS_TURN_SPAN` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `UserVfsTurnView` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `validateAgentDefinition` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `validateDepthSlice` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `VfsError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `VfsZipError` | reexport | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `WorkplaceDirRule` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `WorkplaceListRow` | type | 否 |
| `apps/mobile/test-utils/core-shim.ts` | `wrapUserVfsActionsForStorage` | reexport | 否 |
| `apps/mobile/test-utils/notifee-mock.ts` | `getNotificationSettings` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `onBackgroundEvent` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `onForegroundEvent` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `openNotificationSettings` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `registerForegroundService` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `requestPermission` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/notifee-mock.ts` | `stopForegroundService` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/op-sqlite-mock.ts` | `MOCK_DB` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/react-native-blob-util-mock.ts` | `fs` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/react-native-blob-util-mock.ts` | `MOCK_DIRS` | const | 是（仅内部用，export 冗余） |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `KeyboardStickyView` | function | 否 |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useGenericKeyboardHandler` | function | 否 |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useKeyboardAnimation` | function | 否 |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useKeyboardHandler` | function | 否 |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useKeyboardState` | function | 否 |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useResizeMode` | function | 否 |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `useAnimatedProps` | function | 否 |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `withDelay` | function | 否 |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `withSpring` | function | 否 |
| `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `MESSAGE_CHECKPOINT_FILE_TABLE_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `MESSAGE_CHECKPOINT_SESSION_INDEX_DDL` | const | 否 |
| `packages/core/src/bootstrap/message-checkpoint/message-checkpoint-schema.ts` | `MESSAGE_CHECKPOINT_TABLE_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/schema-align/schema-column-alignments.ts` | `SchemaColumnAlignment` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `isSchemaMigrationApplied` | reexport | 否 |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `markSchemaMigrationApplied` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `SchemaMigration` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/schema-migrations/schema-migrations-table.ts` | `isSchemaMigrationApplied` | function | 否 |
| `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` | `AGENT_CONFIG_SEED_VERSION` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/skills/skills-schema.ts` | `SKILL_DISABLED_SCOPE_INDEX` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts` | `BuiltinSmartSortRuleSeedRow` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/smart-sort-rule/smart-sort-rule-schema.ts` | `SMART_SORT_RULE_ORDER_INDEX` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-content-blob-schema.ts` | `VFS_CONTENT_BLOB_TABLE_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_DELETE_TRIGGER_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_ENTRY_INDEX_DDL` | const | 否 |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_INSERT_TRIGGER_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_TABLE_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-revision-schema.ts` | `VFS_REVISION_UPDATE_TRIGGER_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/vfs/vfs-schema.ts` | `VFS_ENTRY_SCOPE_PATH_INDEX_DDL` | const | 否 |
| `packages/core/src/bootstrap/vfs/vfs-schema.ts` | `VFS_ENTRY_TABLE_DDL` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/bootstrap/workplace/workplace-schema.ts` | `WORKPLACE_FILE_SCOPE_INDEX` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/common/excerpt-release-notes.ts` | `ReleaseNotesFocus` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/common/format-token-count.ts` | `TokenSourceBadge` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/common/index.ts` | `ReleaseNotesFocus` | reexport | 否 |
| `packages/core/src/common/index.ts` | `TokenSourceBadge` | reexport | 否 |
| `packages/core/src/common/memoize.ts` | `memoize` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `buildToolsPolicy` | function | 否 |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `hasEffectivePromptSource` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `joinPersistBlocksForLayout` | function | 否 |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `parseToolsList` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `PROMPT_BLOCK_ROLES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `toolsFromDefinition` | function | 否 |
| `packages/core/src/config-forms/agent/allocate-agent-display-name.ts` | `AgentDisplayNameSlot` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/agent/index.ts` | `AgentDisplayNameSlot` | reexport | 否 |
| `packages/core/src/config-forms/agent/index.ts` | `formatApplicationModelId` | reexport | 否 |
| `packages/core/src/config-forms/agent/index.ts` | `parseApplicationModelId` | reexport | 否 |
| `packages/core/src/config-forms/shared/application-model-id.ts` | `formatApplicationModelId` | function | 否 |
| `packages/core/src/config-forms/shared/application-model-id.ts` | `parseApplicationModelId` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/config-forms/shared/depth-slice.ts` | `matchDepth` | reexport | 否 |
| `packages/core/src/config-forms/shared/depth-slice.ts` | `validateDepthSlice` | reexport | 否 |
| `packages/core/src/config-forms/shared/index.ts` | `formatApplicationModelId` | reexport | 否 |
| `packages/core/src/config-forms/shared/index.ts` | `matchDepth` | reexport | 否 |
| `packages/core/src/config-forms/shared/index.ts` | `parseApplicationModelId` | reexport | 否 |
| `packages/core/src/config-forms/shared/index.ts` | `validateDepthSlice` | reexport | 否 |
| `packages/core/src/config-forms/stored-config-validity/types.ts` | `CURRENT_AGENT_SCHEMA_VERSION` | const | 否 |
| `packages/core/src/config-forms/stored-config-validity/types.ts` | `CURRENT_EVENTS_SCHEMA_VERSION` | const | 否 |
| `packages/core/src/domain/agent/logic/doom-loop.ts` | `assertNoDoomLoop` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/logic/doom-loop.ts` | `DoomLoopChecksConfig` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/logic/resolve-agent-tool-registry.ts` | `ResolveAgentToolRegistryOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/logic/resolve-saved-model-id.ts` | `ResolveSavedModelIdInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/logic/resolve-saved-model-id.ts` | `ResolveSummarySavedModelIdInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `AgentDefinitionDocument` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `agentDefinitionDocumentSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `dynamicTextBlockValueSchema` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/agent/model/agent-definition.schema.ts` | `persistBlockValueSchema` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/character-card/logic/character-card-to-md-tree.ts` | `normalizedCardToMdTree` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/character-card/logic/extract-png-chara.ts` | `extractPngCharaBase64` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/character-card/logic/extract-png-chara.ts` | `PNG_SIGNATURE` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/character-card/logic/parse-character-card-json.ts` | `stripUtf8BomText` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/character-card/logic/validate-md-tree-paths.ts` | `assertMdTreeRelativePathAllowed` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `AnnotateSourceMatch` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `AnnotateSourceMatchStrategy` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `countAnnotateOccurrencesInSource` | function | 否 |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `FlatSegmentLocalRange` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `FlatTextIndex` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-highlight.ts` | `FlatTextSegmentSpan` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `annotateRangeMatchesOriginalText` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `BuildAnnotatedSourceInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `BuildAnnotatedSourceMode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `BuildAnnotatedSourceResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `findMarkdownCodeRanges` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `hasValidAnnotateOffsetRange` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `splitMarkdownUnderlineRuns` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-range.ts` | `AnnotateQuoteContext` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-range.ts` | `applySoftRangeLinePadding` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-range.ts` | `offsetToSourceLineCol` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/annotate-source-range.ts` | `splitSourceLines` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts` | `AttachmentDisplayKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/composer-at-path.ts` | `ComposerTrigger` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/composer-send-intent.ts` | `ComposerSendIntent` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/composer-send-intent.ts` | `ComposerSendIntentAttachment` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/composer-send-intent.ts` | `ComposerSendIntentInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/composer-sendable-input.ts` | `ComposerSendableInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/compute-stream-tail-generating.ts` | `DEFAULT_STREAM_TAIL_IDLE_MS` | const | 否 |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `collectUserOpsChangedPaths` | function | 否 |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `WorkspaceFlushAddedFile` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `WorkspaceFlushChangedFile` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `WorkspaceFlushDiff` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `WorkspaceFlushDiffInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/merge-pending-vfs-turns.ts` | `MergedPendingVfsTurn` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/message-content-codec.ts` | `EncodedMessageContent` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts` | `PrepareUserMessagesForPromptRuntime` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/render-dir-attach-tree.ts` | `ATTACH_DIR_TREE_MAX_UTF8_BYTES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/render-dir-attach-tree.ts` | `RenderDirAttachTreeDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/rollback-confirm-copy.ts` | `RollbackConfirmKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/seed-fork-copy-parity.ts` | `SeedForkCopyParityInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/status-chip-label.ts` | `logicalParentDir` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/status-chip-label.ts` | `renameChipZh` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/status-chip-label.ts` | `STATUS_CHIP_ZH` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/tail-batch-range.ts` | `isTailBatchRowSelectable` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/tail-batch-range.ts` | `TailBatchMode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `deriveToolUsesFromVfsActions` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `formatUserVfsTurnPreviewBody` | function | 否 |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `ParsedUserVfsAction` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `ParsedUserVfsEditHunk` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `USER_VFS_TURN_SPAN` | const | 否 |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `UserVfsTurnView` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/visibility-batch-range.ts` | `isTranscriptRowSelectable` | function | 否 |
| `packages/core/src/domain/chat/logic/visibility-batch-range.ts` | `transcriptSelectableRole` | function | 否 |
| `packages/core/src/domain/chat/logic/visibility-batch-range.ts` | `TranscriptSelectableRole` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/visibility-batch-range.ts` | `VisibilityBatchMessage` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/logic/workspace-flush-snapshot.ts` | `emptyWorkspaceFlushSnapshot` | function | 否 |
| `packages/core/src/domain/chat/model/annotate-draft.schema.ts` | `AnnotateDrafts` | type | 否 |
| `packages/core/src/domain/chat/model/annotate-draft.schema.ts` | `annotateDraftsSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/annotate-draft.schema.ts` | `MESSAGE_ANNOTATE_PATH_MARKER` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `ComposerDraft` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `ComposerDraftAttachment` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `composerDraftAttachmentSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `EMPTY_COMPOSER_DRAFT` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `isComposerDraftAttachment` | function | 否 |
| `packages/core/src/domain/chat/model/message-attachment.schema.ts` | `messageAttachmentActionSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/message-attachment.schema.ts` | `MessageAttachments` | type | 否 |
| `packages/core/src/domain/chat/model/message-metadata.ts` | `MessageMetadata` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/message-metadata.ts` | `MessageMetadataKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/message.ts` | `MessageUsage` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/project-agent-config.ts` | `ProjectAgentMode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/chat/model/user-vfs-pending.schema.ts` | `UserVfsPendingQueue` | type | 否 |
| `packages/core/src/domain/chat/model/user-vfs-pending.schema.ts` | `UserVfsPendingTool` | type | 否 |
| `packages/core/src/domain/chat/model/user-vfs-pending.schema.ts` | `userVfsPendingToolSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/compaction-conditions/model/compaction-conditions.schema.ts` | `DEFAULT_HIDE_START_DEPTH` | reexport | 否 |
| `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | `CompactionConditionModelContext` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts` | `DEFAULT_HEURISTIC_SAFETY_FACTOR` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts` | `TokenRatioTriggerOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/depth/logic/depth-from-tail.ts` | `depthByMessageId` | function | 否 |
| `packages/core/src/domain/depth/logic/depth-from-tail.ts` | `depthFromTailIndex` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/depth/logic/depth-slice.ts` | `depthSliceFromWire` | function | 否 |
| `packages/core/src/domain/depth/logic/resolve-hide-message-range.ts` | `HideMessageSeqRange` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/events/model/event-types.ts` | `AgentStepCommittedPhase` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/events/model/event-types.ts` | `NovelMasterEventPayload` | type | 否 |
| `packages/core/src/domain/events/model/event-types.ts` | `NovelMasterEventType` | type | 否 |
| `packages/core/src/domain/format/format-stream-metrics-line.ts` | `StreamMetricsLineInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/format/sliding-token-rate.ts` | `SLIDING_TOKEN_RATE_WINDOW_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/format/sliding-token-rate.ts` | `TokenRateSample` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/format/stream-final-rate.ts` | `StreamFinalRateSnapshot` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` | `BackfillBaselineResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/backfill-missing-revision.ts` | `BackfillRevisionDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/resolve-reconcile-paths.ts` | `ReconcilePathSets` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/resolve-target-tree.ts` | `RollbackTargetTreeResolution` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/restore-path.ts` | `ensureDirectoryChain` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/restore-path.ts` | `RestorePathOutcome` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/logic/revive-deleted-entry.ts` | `ReviveDeletedEntryDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/message-checkpoint/model/message-checkpoint.ts` | `MessageCheckpoint` | interface | 否 |
| `packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts` | `DynamicPromptBlockWire` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts` | `PersistPromptBlockWire` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/agent-prompt-layout-wire.ts` | `PersistTextBlockWire` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/expand-dynamic-macros.ts` | `DynamicMacroContext` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/message-body.ts` | `formatChatMessageForCliPreview` | reexport | 否 |
| `packages/core/src/domain/prompt/logic/message-body.ts` | `messageBodyTextFromBlocks` | reexport | 否 |
| `packages/core/src/domain/prompt/logic/message-body.ts` | `messageBodyTextFromContent` | reexport | 否 |
| `packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` | `isLegacyWorktreeWireBlock` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` | `LegacyPersistWorktreeWireBlock` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/normalize-for-llm-export.ts` | `LlmExportZone` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/validate-agent-prompt-layout.ts` | `resolveWorkplaceFromWire` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts` | `validatePromptBlocksFromMap` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/prompt/model/agent-prompt-layout.ts` | `PersistWorktreePromptBlock` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_IDS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUID_GOOGLE` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUID_OPENROUTER` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `builtinProtocolByProviderId` | function | 否 |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `builtinProtocolByProviderKey` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BuiltinProviderSeedRow` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/logic/infer-llm-protocol-from-model-id.ts` | `inferLlmProtocolFromApplicationModelId` | function | 否 |
| `packages/core/src/domain/provider/model/model-sampling-params.ts` | `AnthropicSamplingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-sampling-params.ts` | `GeminiSamplingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-sampling-params.ts` | `OpenAiSamplingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-sampling-params.ts` | `samplingProtocol` | function | 否 |
| `packages/core/src/domain/provider/model/model-suggestion-cache.schema.ts` | `modelSuggestionCacheDocumentSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-suggestion-cache.ts` | `ModelSuggestionEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | `AnthropicThinkingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | `GeminiThinkingConfig` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | `GeminiThinkingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | `OpenAiThinkingParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/model-thinking-params.ts` | `thinkingProtocol` | function | 否 |
| `packages/core/src/domain/provider/model/protocol-sampling-defaults.ts` | `ANTHROPIC_SAMPLING_DEFAULTS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model-settings.schema.ts` | `savedModelSettingsDocumentSchema` | const | 否 |
| `packages/core/src/domain/provider/model/saved-model-settings.schema.ts` | `savedModelSettingsV2DocumentSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model-settings.schema.ts` | `thinkingLevelSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model-settings.ts` | `SavedModelGenerationSettings` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model-settings.ts` | `SavedModelInternalSettings` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model.ts` | `SavedModelView` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/provider/model/saved-model.ts` | `toSavedModelView` | function | 否 |
| `packages/core/src/domain/provider/model/thinking-level-options.ts` | `THINKING_LEVEL_OPTIONS` | const | 否 |
| `packages/core/src/domain/session-kkv/logic/file-cache-blob-codec.ts` | `HashedFileCachePayload` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts` | `SessionKkvDomain` | type | 否 |
| `packages/core/src/domain/skills/logic/effective-skills.ts` | `EffectiveSkillsInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/logic/parse-skill-front-matter.ts` | `ParsedSkillFrontMatter` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/logic/skill-paths.ts` | `SkillRelPathInvalidReason` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/logic/skill-paths.ts` | `SkillRelPathResolution` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts` | `SkillFrontMatterValues` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/model/skill-name.ts` | `SKILL_RESERVED_NAME` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/skills/model/skill.schema.ts` | `SkillFrontMatter` | type | 否 |
| `packages/core/src/domain/skills/model/skill.schema.ts` | `SkillRef` | interface | 否 |
| `packages/core/src/domain/smart-sort-rule/logic/compile-smart-sort-rule.ts` | `SmartSortRuleValidationFields` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/logic/match-smart-sort-pattern.ts` | `MatchSmartSortPatternErr` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/logic/match-smart-sort-pattern.ts` | `MatchSmartSortPatternOk` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/logic/parse-pattern-input.ts` | `ParsedPatternInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/logic/split-smart-sort-highlight-segments.ts` | `SmartSortHighlightMatchInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/logic/split-smart-sort-highlight-segments.ts` | `SmartSortHighlightSegment` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule-io.ts` | `SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule-io.ts` | `smartSortRuleBundleDocumentSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule-io.ts` | `SmartSortRuleBundleRule` | type | 否 |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts` | `CreateSmartSortRuleFields` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts` | `createSmartSortRuleSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.schema.ts` | `updateSmartSortRuleSchema` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/smart-sort-rule/model/smart-sort-rule.ts` | `BUILTIN_SMART_SORT_RULE_ID_PREFIX` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolGetOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolListEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolListOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/agent-tool.ts` | `AgentToolWriteOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `ResolveChildModelIdResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `ToolResourceQuota` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `VfsToolContext` | type | 否 |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_DEFAULT_TIMEOUT_SECONDS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_MAX_HEADER_VALUE_BYTES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_MAX_HEADERS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_MAX_REQUEST_BODY_BYTES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_MAX_RESPONSE_BYTES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CURL_MAX_TIMEOUT_SECONDS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CurlToolInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/curl-tool.ts` | `CurlToolOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/overflow-sink.ts` | `extensionForContentType` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/overflow-sink.ts` | `OVERFLOW_SINK_DIR` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/overflow-sink.ts` | `SinkOversizedInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/register-builtin-tools.ts` | `registerVfsTools` | function | 否 |
| `packages/core/src/domain/tool/builtin/search/engines/brave.ts` | `BRAVE_DOMAIN_FILTER_COUNT` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/engines/brave.ts` | `BRAVE_TIMEOUT_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/engines/duckduckgo.ts` | `DUCKDUCKGO_TIMEOUT_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/engines/searxng.ts` | `SEARXNG_TIMEOUT_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/engines/tavily.ts` | `TAVILY_TIMEOUT_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `SearchEngineStatus` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/search-tool.ts` | `SEARCH_CHAIN_BUDGET_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/search-tool.ts` | `SearchToolInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/search-tool.ts` | `SearchToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/search/types.ts` | `SearchRecency` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolEditOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolListOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolLoadOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolReadOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/skill-tool.ts` | `SkillToolWriteOutput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `AgentDefinition` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `BuiltinToolContext` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `FILE_OPEN_TOOL_NAMES` | const | 否 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `FileToolName` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `GlobToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `GrepToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `isMutatingVfsToolName` | const | 否 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `MUTATING_VFS_TOOL_NAMES` | const | 否 |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `ReadToolOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `VfsReadResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `VfsToolContext` | type | 否 |
| `packages/core/src/domain/tool/logic/build-tool-result-block.ts` | `BuildToolResultBlockMeta` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatCurlOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatGlobOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatGrepOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatReadOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatSearchOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `formatSkillLoadOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `FormatToolErrorForLlmOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isSkillLoadOutput` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/fs-command-classify.ts` | `FsCommandClassification` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/fs-command.ts` | `FsCommand` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/fs-command.ts` | `FsLsOutput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `isTaskToolUse` | function | 否 |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `ToolResultBlock` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `ToolUseBlock` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/tool-output-limits.ts` | `TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/tool/logic/tool-output-limits.ts` | `TOOL_OUTPUT_MAX_LINE_LENGTH` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/content-store/logic/resolve-stored-content.ts` | `StoredContentFields` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts` | `asUint8Array` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/compute-replace-result.ts` | `ComputeReplaceResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/compute-replace-result.ts` | `ComputeReplaceResultOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/entry-sequence-repair.ts` | `VFS_ENTRY_SEQUENCE_REPAIR_NAME` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/extract-mutating-paths.ts` | `MutatingToolCall` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | `InferredScope` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | `inferScopeFromPhysicalPath` | function | 否 |
| `packages/core/src/domain/vfs/logic/longest-common-substring.ts` | `LongestCommonSubstringResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts` | `MutatingPathHeadAbsent` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts` | `MutatingPathHeadDirectory` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts` | `MutatingPathHeadPresent` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts` | `MutatingPathHeadSnapshot` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/revision-ref-count.ts` | `CheckpointFilePointer` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/revision-ref-count.ts` | `RepairReport` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/user-vfs-save-mapping.ts` | `UserVfsEditHunk` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/user-vfs-save-mapping.ts` | `UserVfsSaveMappingResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/validate-entry-name.ts` | `vfsEntryNameOfPath` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/validate-entry-name.ts` | `VfsEntryNameValidation` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-copy.ts` | `CopyVfsPathOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-exclude-prefixes.ts` | `normalizeExcludePrefix` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-grep.ts` | `VfsGrepContentRow` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-grep.ts` | `VfsGrepMatchMode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-move.ts` | `assertMoveTargetAvailable` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts` | `projectVfsPrefix` | function | 否 |
| `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` | `CopyVfsTreeOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` | `ReplaceVfsSubtreeOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-tree-copy.ts` | `VfsCopyScope` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts` | `ZipCentralDirEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `basenameOfLogicalPath` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `logicalFromZipDirectoryEntryName` | function | 否 |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `logicalFromZipEntryName` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `zipDirectoryEntryNameFromLogical` | function | 否 |
| `packages/core/src/domain/vfs/logic/vfs-zip-path.ts` | `zipEntryNameFromLogical` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts` | `VFS_ZIP_MAX_ENTRY_COUNT` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts` | `VFS_ZIP_MAX_UNCOMPRESSED_BYTES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts` | `VfsZipValidatedPayload` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/model/vfs-list-entry.ts` | `VfsEntryKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | `BatchExportFileEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | `BatchIngestTypeConflict` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `VfsContentSize` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `VfsEntryKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `VfsGrepMatchMode` | type | 否 |
| `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | `VfsEntryKind` | type | 否 |
| `packages/core/src/domain/workplace/logic/diff-workplace-paths.ts` | `isWorkplacePathLoadedInCache` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/diff-workplace-paths.ts` | `WorkplaceLivePath` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/front-matter.ts` | `MarkdownFrontMatterSplit` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts` | `FillFileCacheOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts` | `LoadOrFillFileCacheDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/smart-sort.ts` | `SmartSortKeyDetail` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/workplace-display.ts` | `formatLocalMtime` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/workplace-eval.ts` | `SortDirPathsOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/workplace-eval.ts` | `SortFilesForDirOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/workplace-file-tree.ts` | `RenderWorkplaceFileTreeForMacroParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/logic/workplace-file-tree.ts` | `RenderWorkplaceFileTreeParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/model/workplace-types.ts` | `WorkplaceDirRuleRow` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/model/workplace-types.ts` | `WorkplaceFileRuleRow` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/repositories/workplace.port.ts` | `InclusionMode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/repositories/workplace.port.ts` | `WorkplaceDirRule` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/domain/workplace/repositories/workplace.port.ts` | `WorkplaceFileRule` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/agent-config-errors.ts` | `AgentConfigErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/agent-runtime-errors.ts` | `AgentErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/agent-runtime-errors.ts` | `agentUnsupportedProvider` | function | 否 |
| `packages/core/src/errors/character-card-errors.ts` | `CharacterCardErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/chat-errors.ts` | `ChatErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/compaction-conditions-errors.ts` | `CompactionConditionsErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/config-decode-errors.ts` | `ConfigDecodeErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/kkv-errors.ts` | `KkvErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/preferences-errors.ts` | `PreferencesErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/prompt-errors.ts` | `PromptErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/provider-errors.ts` | `ProviderErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/session-fs-errors.ts` | `isRollbackConflictError` | function | 否 |
| `packages/core/src/errors/session-fs-errors.ts` | `SessionFsErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/skill-errors.ts` | `SkillErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/smart-sort-rule-errors.ts` | `SmartSortRuleErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/tool-errors.ts` | `ToolErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/tool-errors.ts` | `ToolErrorDetails` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/errors/vfs-zip-errors.ts` | `VfsZipErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/errors/cloud-sync-errors.ts` | `CloudSyncErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `__resetDefaultPushAgentMutexForTests` | function | 否 |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `CloudSyncCoordinatorDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `getDefaultPushAgentMutex` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `PullOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `PullResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `PushOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts` | `PushResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/index.ts` | `buildLease` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `canAcquireLock` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `CloudSyncCoordinatorDeps` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `CloudSyncErrorCode` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `CloudSyncLock` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `CloudSyncStatus` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `DbSyncPort` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `DEFAULT_LEASE_SECONDS` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `EMPTY_CLOUD_SYNC_STATUS` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `isEffectiveLock` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `PullOptions` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `PullResult` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `PushOptions` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `PushResult` | type | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `renewLease` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/index.ts` | `snapshotKey` | reexport | 否 |
| `packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts` | `PushAgentMutexAcquireErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/cloud-sync/logic/push-agent-mutex.ts` | `PushAgentMutexAcquireOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts` | `DecodedContentPoolLimits` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts` | `DecodedContentPoolStats` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-backup/index.ts` | `DB_BACKUP_PROVIDER_TABLES` | reexport | 否 |
| `packages/core/src/infra/db-backup/index.ts` | `ProviderBackupTableName` | reexport | 否 |
| `packages/core/src/infra/db-backup/index.ts` | `ProviderTableSnapshotErrorCode` | reexport | 否 |
| `packages/core/src/infra/db-backup/index.ts` | `validateProviderTableSnapshot` | reexport | 否 |
| `packages/core/src/infra/db-backup/provider-table-snapshot-error.ts` | `ProviderTableSnapshotErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts` | `BlobBinaryStatus` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts` | `BlobBinaryTableId` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts` | `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts` | `RunMessageContentCompactionOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/db-maintenance/index.ts` | `BlobBinaryStatus` | type | 否 |
| `packages/core/src/infra/db-maintenance/index.ts` | `BlobBinaryTableId` | type | 否 |
| `packages/core/src/infra/db-maintenance/index.ts` | `DatabaseMaintenanceResult` | type | 否 |
| `packages/core/src/infra/db-maintenance/index.ts` | `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` | reexport | 否 |
| `packages/core/src/infra/db-maintenance/index.ts` | `RunMessageContentCompactionOptions` | type | 否 |
| `packages/core/src/infra/db-maintenance/index.ts` | `StorageStats` | type | 否 |
| `packages/core/src/infra/events/simple-event-bus.ts` | `EventBus` | type | 否 |
| `packages/core/src/infra/events/simple-event-bus.ts` | `EventHandler` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/events/simple-event-bus.ts` | `SimpleEventBusOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | `parseKkvJsonDocument` | function | 否 |
| `packages/core/src/infra/llm-protocol/logic/anthropic-sse-parser.ts` | `AnthropicSseParserState` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/anthropic-tool-names.ts` | `ANTHROPIC_WIRE_TOOL_NAME_PATTERN` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/debug-fetch.ts` | `isLlmFetchDebugEnabled` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/dispatch-sse-chunk.ts` | `SseDispatchState` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/gemini-content-mapper.ts` | `ChatMessagesToGeminiContentsOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/gemini-content-mapper.ts` | `GeminiPartsToBlocksOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/gemini-sse-parser.ts` | `GeminiSseParserState` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `PostSseOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/llm-stream-timeout-error.ts` | `LLM_STREAM_TIMEOUT_ERROR_NAME` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/llm-stream-timeout-error.ts` | `LlmStreamTimeoutPhase` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/openai-content-mapper.ts` | `OpenAiChatMessage` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/openai-sse-parser.ts` | `OpenAiSseParserState` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts` | `SseChunkEmitter` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/sse-line-buffer.ts` | `SseLineBufferState` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/stream-partial-blocks.ts` | `StreamPartialInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/stream-partial-blocks.ts` | `StreamPartialToolUse` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts` | `StreamWatchdog` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts` | `StreamWatchdogOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/llm-protocol/logic/tool-arguments-parse.ts` | `TryParseToolArgumentsResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/nmtp/index.ts` | `getTokenizerDriver` | reexport | 否 |
| `packages/core/src/infra/nmtp/index.ts` | `resolveTokenizerDriver` | reexport | 否 |
| `packages/core/src/infra/nmtp/index.ts` | `TokenizerDriver` | type | 否 |
| `packages/core/src/infra/nmtp/index.ts` | `TokenizerErrorCode` | type | 否 |
| `packages/core/src/infra/nmtp/nmtp-error.ts` | `TokenizerErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/prompt-template/macro-render.ts` | `MacroRenderContext` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/prompt-template/macro-scan.ts` | `MacroAction` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/prompt-template/macro-scan.ts` | `MacroActionKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/serialization/encode.ts` | `EncodableSchema` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/serialization/stringify-text.ts` | `TextFormat` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sksp/impl/composite-secret-store.ts` | `EnvSecretStoreLike` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sksp/index.ts` | `assertValidRef` | reexport | 否 |
| `packages/core/src/infra/sksp/index.ts` | `EnvSecretStore` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sksp/index.ts` | `EnvSecretStoreLike` | type | 否 |
| `packages/core/src/infra/sksp/index.ts` | `getSkspDriver` | reexport | 否 |
| `packages/core/src/infra/sksp/index.ts` | `refToEnvVar` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sksp/index.ts` | `resolveSkspEnvOverride` | reexport | 否 |
| `packages/core/src/infra/sksp/index.ts` | `SkspDriver` | type | 否 |
| `packages/core/src/infra/sksp/logic/registry.ts` | `getSkspDriver` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sksp/logic/registry.ts` | `SkspDriver` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/errors.ts` | `SqlTemplateErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/evaluator.ts` | `EvaluateState` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/expression.ts` | `EvaluateTestOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/index.ts` | `AstNode` | type | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `bindExpressionToContext` | reexport | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `evaluateTest` | reexport | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `EvaluateTestOptions` | type | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `ForeachAttrs` | type | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `normalizeExpression` | reexport | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `ParseOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/index.ts` | `parseTemplateToAst` | reexport | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `SqlParseResult` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/index.ts` | `SqlTemplateError` | reexport | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `SqlTemplateErrorCode` | type | 否 |
| `packages/core/src/infra/sql-template/index.ts` | `TemplateParser` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/index.ts` | `TrimAttrs` | type | 否 |
| `packages/core/src/infra/sql-template/placeholder.ts` | `BindResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/sql-template/tags/where.ts` | `stripLeadingAndOr` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tdbc/errors.ts` | `TdbcErrorCode` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tdbc/index.ts` | `executeTemplate` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `getDriver` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `listDrivers` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `ParsedTdbcUrl` | type | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `parseUrl` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `queryTemplate` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `resolveDriver` | reexport | 否 |
| `packages/core/src/infra/tdbc/index.ts` | `TdbcErrorCode` | type | 否 |
| `packages/core/src/infra/tdbc/logic/open.ts` | `ParsedTdbcUrl` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tdbc/logic/registry.ts` | `getDriver` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tdbc/logic/registry.ts` | `listDrivers` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `EncodingFactory` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/index.ts` | `AdvanceGenerationOptions` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ChatTokenCountKind` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ChatTokenEncoder` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ChatTokenMessage` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CHUNK_CACHE_MAX_TOTAL_ENTRIES` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CONTEXT_WINDOW_RULES` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CounterScopeInput` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CountOpenAiStyleMessageOptions` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `countTokens` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CountTokensOptions` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `CreateDefaultTokenCounterRegistryDeps` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `DEFAULT_CONTEXT_WINDOW_TOKENS` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ENCODING_RETRY_TTL_MS` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `EncodingFactory` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ForVendorModelOptions` | type | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `getTokenizerDriver` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `invalidateSessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `MAX_CHUNK_CHARS` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `parseSessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `parseTokenChunkCachePayload` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `parseTokenCounterModePref` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `PROMPT_WHOLE_CACHE_LRU_PER_SESSION` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `PromptTokenSource` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `PromptWholeCacheEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `readSessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `registerTokenizerDriver` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ResolveCurrentPromptTokensOptions` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `ResolvedPromptTokens` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `resolveTokenizerDriver` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `seedContextWindowTokens` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `serializeSessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `SessionApiPromptTokenCacheEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `SessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `setClockForTests` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TOKEN_COUNTER_MODE_PREF_KEY` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenChunkCacheItem` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenEncoder` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenizerDriver` | type | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenizerErrorCode` | type | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenSourceBadge` | reexport | 否 |
| `packages/core/src/infra/tokenizer/index.ts` | `writeSessionApiPromptTokenEntry` | reexport | 否 |
| `packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `ChatTokenEstimateMemoEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `stampToolsForEstimateMemo` | function | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/count-openai-style-message.ts` | `CountOpenAiStyleMessageOptions` | interface | 否 |
| `packages/core/src/infra/tokenizer/logic/count-openai-style-message.ts` | `TokenEncoder` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/count-tokens.ts` | `ChatTokenCountKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/count-tokens.ts` | `ChatTokenEncoder` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/count-tokens.ts` | `ChatTokenMessage` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/count-tokens.ts` | `CountTokensOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/create-default-registry.ts` | `CreateDefaultTokenCounterRegistryDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/format-token-source-badge.ts` | `TokenSourceBadge` | reexport | 否 |
| `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts` | `DEFAULT_COMMIT_STEP_CHARS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts` | `DEFAULT_LOOKBACK_CHARS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts` | `DEFAULT_TAIL_CHARS` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/read-token-counter-mode-pref.ts` | `TOKEN_COUNTER_MODE_PREF_KEY` | const | 否 |
| `packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts` | `PromptTokenSource` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-cache.ts` | `SessionApiPromptTokenCacheEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts` | `SessionApiPromptTokenEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `AdvanceGenerationOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `CHUNK_CACHE_MAX_TOTAL_ENTRIES` | const | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `CounterScopeInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `TokenChunkCacheItem` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/agent-stream-registry.port.ts` | `AgentStreamPartial` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/impl/agent-registry.service.ts` | `DefaultAgentRegistryServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `DefaultAgentRunnerDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts` | `ShouldApplyTranscriptReloadOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/logic/assemble-agent-runner-deps.ts` | `AssembleAgentRunnerDepsInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/logic/resolve-agent-for-project.ts` | `ResolveAgentForProjectRuntimePort` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `RunAgentTurnAfterResolveContext` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `RunAgentTurnOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/create-chat-services.ts` | `ChatServiceBundle` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/create-chat-services.ts` | `ChatServicesOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/create-chat-services.ts` | `ChatServicesSessionDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/create-user-vfs-turn-service.ts` | `createUserVfsTurnService` | function | 否 |
| `packages/core/src/service/chat/create-user-vfs-turn-service.ts` | `UserVfsTurnServiceBundle` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/impl/message-transcript-effects.service.ts` | `MessageTranscriptEffectsServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/impl/message.service.ts` | `MessageServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/impl/project.service.ts` | `ProjectServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/chat/impl/session.service.ts` | `SessionServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/compaction-conditions/create-compaction-condition-evaluator.ts` | `CreateCompactionConditionEvaluatorDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/compaction-conditions/hide-message.action.ts` | `HideMessageHandlerDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/compaction-conditions/run-compaction.ts` | `RunCompactionParams` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/compaction-conditions/run-compaction.ts` | `RunCompactionResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/coordinated-write.ts` | `WriteStep` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/integrity-repair.ts` | `IntegrityRepairKind` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/integrity-repair.ts` | `IntegrityRepairReport` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/kkv/index.ts` | `createKkvService` | reexport | 否 |
| `packages/core/src/service/kkv/index.ts` | `isKkvError` | reexport | 否 |
| `packages/core/src/service/kkv/index.ts` | `KkvError` | reexport | 否 |
| `packages/core/src/service/kkv/index.ts` | `KkvErrorCode` | type | 否 |
| `packages/core/src/service/kkv/index.ts` | `KkvService` | type | 否 |
| `packages/core/src/service/message-checkpoint/impl/message-checkpoint.service.ts` | `MessageCheckpointServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts` | `MessageRollbackServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/message-checkpoint/truncate-tail-wiring.ts` | `TruncateTailDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/message-checkpoint/truncate-tail-wiring.ts` | `TruncateTailParams` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/apply-thinking-context-for-llm.ts` | `ThinkingContextOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/render-prompt.ts` | `PromptAssemblySegment` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/render-prompt.ts` | `PromptLlmInput` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/render-prompt.ts` | `PromptRenderContext` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/resolve-preview-thinking-context.ts` | `ResolvedPreviewThinkingContext` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/prompt/resolve-preview-thinking-context.ts` | `ResolvePreviewThinkingContextInput` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/provider/impl/model-request.service.ts` | `DefaultModelRequestServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/provider/impl/provider-model.service.ts` | `DefaultProviderModelServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/provider/impl/provider.service.ts` | `DefaultProviderServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/session-fs/create-session-fs-service.ts` | `SessionFsServiceOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/session-fs/impl/session-fs.service.ts` | `SessionFsServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/session-kkv/index.ts` | `fileCacheKey` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `RULE_SNAPSHOT_CANON_KEY` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `SESSION_KKV_COMPOSER_STATUS_DOMAINS` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `SESSION_KKV_DOMAIN_RULE_SNAPSHOT` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `SESSION_KKV_DOMAIN_USER_VFS_PENDING` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `SessionKkvService` | type | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `USER_VFS_PENDING_QUEUE_KEY` | reexport | 否 |
| `packages/core/src/service/session-kkv/index.ts` | `WorkplaceDisplayStatus` | reexport | 否 |
| `packages/core/src/service/session-run-state/index.ts` | `createSessionRunStateService` | reexport | 否 |
| `packages/core/src/service/session-run-state/index.ts` | `SessionRunState` | type | 否 |
| `packages/core/src/service/session-run-state/index.ts` | `SessionRunStateService` | type | 否 |
| `packages/core/src/service/session-run-state/index.ts` | `SessionRunStateSettleInput` | type | 否 |
| `packages/core/src/service/session-run-state/index.ts` | `SessionRunStatus` | type | 否 |
| `packages/core/src/service/skills/impl/skills.service.ts` | `SkillsServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts` | `SmartSortBuiltinSeedRow` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts` | `SmartSortRuleServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/template/logic/initialize-session-workspace.ts` | `InitializeSessionWorkspaceOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/create-character-card-import-service.ts` | `CreateCharacterCardImportServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/create-vfs-batch-io-service.ts` | `CreateVfsBatchIoServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/create-vfs-zip-io-service.ts` | `CreateVfsZipIoServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/impl/character-card-import.service.ts` | `DefaultCharacterCardImportServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/impl/vfs-batch-io.service.ts` | `DefaultVfsBatchIoServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts` | `DefaultVfsZipIoServiceOptions` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts` | `EnsureImportDirRulesDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/vfs/vfs.port.ts` | `VfsGrepMatchMode` | type | 否 |
| `packages/core/src/service/vfs/vfs.port.ts` | `VfsZipImportOptions` | type | 否 |
| `packages/core/src/service/vfs/vfs.port.ts` | `VfsZipIoService` | type | 否 |
| `packages/core/src/service/workplace/assemble-workplace-display.ts` | `AssembleWorkplaceDisplayDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/assemble-workplace-display.ts` | `AssembleWorkplaceDisplayOptions` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/assemble-workplace-display.ts` | `AssembleWorkplaceDisplayResult` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/assemble-workplace-display.ts` | `layoutHasWorkplace` | reexport | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/impl/workplace-view-cache.ts` | `WorkplaceViewCacheEntry` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/impl/workplace.service.ts` | `WorkplaceServiceDeps` | interface | 是（仅内部用，export 冗余） |
| `packages/core/src/service/workplace/refresh-rule-snapshot.ts` | `RefreshRuleSnapshotDeps` | type | 是（仅内部用，export 冗余） |
| `packages/core/src/types/agnai-tokenizers.d.ts` | `cleanText` | function | 否 |

## 二、零消费但 suspect（拿不准，不判死）

| 文件 | 符号 | 导出类型 | 可疑原因（同名符号出现在这些未解析说明符里） |
|---|---|---|---|
| `apps/mobile/test-utils/document-picker-mock.ts` | `errorCodes` | const | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `isErrorWithCode` | function | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `isKnownType` | function | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `keepLocalCopy` | const | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `pick` | const | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `saveDocuments` | const | `@react-native-documents/picker` |
| `apps/mobile/test-utils/document-picker-mock.ts` | `types` | const | `@react-native-documents/picker` |
| `apps/mobile/test-utils/notifee-mock.ts` | `AndroidImportance` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/notifee-mock.ts` | `AuthorizationStatus` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/notifee-mock.ts` | `createChannel` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/notifee-mock.ts` | `displayNotification` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/notifee-mock.ts` | `EventType` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/notifee-mock.ts` | `onForegroundEventUnsubscribe` | const | `@notifee/react-native` |
| `apps/mobile/test-utils/op-sqlite-mock.ts` | `ANDROID_FILES_PATH` | const | `@op-engineering/op-sqlite` |
| `apps/mobile/test-utils/op-sqlite-mock.ts` | `IOS_DOCUMENT_PATH` | const | `@op-engineering/op-sqlite` |
| `apps/mobile/test-utils/op-sqlite-mock.ts` | `open` | const | `@op-engineering/op-sqlite`<br>`react-native-quick-sqlite` |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `KeyboardAvoidingView` | function | `react-native-keyboard-controller` |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `KeyboardProvider` | function | `react-native-keyboard-controller` |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `useReanimatedKeyboardAnimation` | function | `react-native-keyboard-controller` |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `Easing` | const | `react-native-reanimated`<br>`react-native` |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `useAnimatedStyle` | function | `react-native-reanimated` |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `useSharedValue` | function | `react-native-reanimated` |
| `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `withTiming` | function | `react-native-reanimated` |
| `apps/mobile/test-utils/react-native-webview-mock.tsx` | `WebViewMessageEvent` | type | `react-native-webview` |
| `packages/core/src/types/agnai-tokenizers.d.ts` | `SentencePieceProcessor` | class | `@agnai/sentencepiece-js` |
| `packages/core/src/types/agnai-tokenizers.d.ts` | `Tokenizer` | class | `@agnai/web-tokenizers` |

## 三、仅测试消费（生产零消费，弱于死导出）

| 文件 | 符号 | 导出类型 | 测试消费方 |
|---|---|---|---|
| `apps/cli/src/prompt/commands.ts` | `buildCliNoModelTokenDiagnostic` | function | `apps/cli/test/prompt-token-fallback.test.ts` |
| `apps/cli/src/prompt/commands.ts` | `resolveCliPromptTokens` | function | `apps/cli/test/prompt-token-fallback.test.ts` |
| `apps/cli/src/runtime.ts` | `registerPlatformSkspDriver` | function | `apps/cli/test/sksp-platform.test.ts` |
| `apps/desktop/renderer/components/code-block.tsx` | `normalizeFenceLang` | function | `apps/desktop/test/code-block-render.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `isMermaidKnownFailed` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `lookupMermaidFailedError` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `lookupMermaidSvg` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `nextMermaidId` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `resetMermaidCacheForTests` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `resolveMermaidSvg` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `resolveMermaidTheme` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `scanMermaidFences` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/components/MermaidMarkdown.tsx` | `setMermaidSvgRendererForTests` | function | `apps/desktop/test/mermaid-markdown.test.tsx` |
| `apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx` | `attachmentChipClassName` | function | `apps/desktop/test/attachment-draft-chips.test.ts` |
| `apps/desktop/renderer/features/chat/AttachmentDraftChips.tsx` | `formatAttachmentChipLabel` | function | `apps/desktop/test/attachment-draft-chips.test.ts` |
| `apps/desktop/renderer/features/chat/chat-annotate-draft.ts` | `chipsFromAnnotateStore` | function | `apps/desktop/test/chat-annotate-draft.test.ts` |
| `apps/desktop/renderer/features/chat/chat-annotate-draft.ts` | `resetChatAnnotateDraftStoreForTests` | reexport | `apps/desktop/test/chat-annotate-draft.test.ts` |
| `apps/desktop/renderer/features/chat/chat-link-route.ts` | `ChatLinkProbeRead` | type | `apps/desktop/test/chat-link-route.test.ts` |
| `apps/desktop/renderer/features/chat/chat-messages-scroll.ts` | `offsetFromBottom` | function | `apps/desktop/test/chat-messages-scroll.test.ts` |
| `apps/desktop/renderer/features/chat/composer-at-path.ts` | `countScannedAtPathAttachments` | reexport | `apps/desktop/test/composer-at-path.test.ts` |
| `apps/desktop/renderer/features/chat/ComposerAtPathInput.tsx` | `renderComposerAtPathHighlightHtml` | function | `apps/desktop/test/composer-at-path.test.ts` |
| `apps/desktop/renderer/features/chat/conversation-abort-retain.ts` | `AbortRetainLifecycle` | type | `apps/desktop/test/conversation-abort-retain.test.ts`<br>`apps/desktop/test/conversation-panel-abort.test.ts` |
| `apps/desktop/renderer/features/chat/conversation-abort-retain.ts` | `shouldAcceptStreamIngress` | function | `apps/desktop/test/conversation-panel-abort.test.ts` |
| `apps/desktop/renderer/features/chat/conversation-abort-retain.ts` | `stepCommittedShouldReload` | function | `apps/desktop/test/conversation-abort-retain.test.ts` |
| `apps/desktop/renderer/features/chat/FileReferencePicker.tsx` | `atPathTokensFromPickerSelection` | reexport | `apps/desktop/test/file-reference-picker.test.ts` |
| `apps/desktop/renderer/features/chat/FileReferencePicker.tsx` | `listPickerChildRows` | function | `apps/desktop/test/file-reference-picker.test.ts` |
| `apps/desktop/renderer/features/chat/flush-run-ui.ts` | `flushRunUi` | function | `apps/desktop/test/flush-run-ui.test.ts` |
| `apps/desktop/renderer/features/chat/message-blocks.ts` | `isTurnToolExecuting` | function | `apps/desktop/test/message-blocks.test.ts` |
| `apps/desktop/renderer/features/chat/message-edit.ts` | `isSetFloorEligibleMessage` | function | `apps/desktop/test/message-action-items.test.ts` |
| `apps/desktop/renderer/features/chat/MessageAttachmentGroupCard.tsx` | `formatMessageAttachmentLabel` | function | `apps/desktop/test/message-attachment-group-card.test.ts` |
| `apps/desktop/renderer/features/chat/readOnlyRunProbeLogic.ts` | `READONLY_RUN_PROBE_RECONFIRM_DELAY_MS` | const | `apps/desktop/test/read-only-run-probe.test.ts` |
| `apps/desktop/renderer/features/chat/readOnlyRunProbeLogic.ts` | `RunActiveQueryResult` | type | `apps/desktop/test/read-only-run-probe.test.ts` |
| `apps/desktop/renderer/features/settings/settings-nav.ts` | `isSameSkillRef` | function | `apps/desktop/test/settings-nav-guard.test.ts` |
| `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts` | `logicalPathForSegmentIndex` | function | `apps/desktop/test/vfs-tree-utils.test.ts` |
| `apps/desktop/renderer/features/workspace/vfs-tree-utils.ts` | `logicalPathSegments` | function | `apps/desktop/test/vfs-tree-utils.test.ts` |
| `apps/desktop/renderer/features/workspace/workspace-actions.ts` | `defaultDirRuleRequest` | function | `apps/desktop/test/workspace-actions.test.ts` |
| `apps/desktop/renderer/features/workspace/workspace-actions.ts` | `emptyDirRuleForm` | function | `apps/desktop/test/workspace-actions.test.ts` |
| `apps/desktop/renderer/hooks/useAgentRunLifecycle.ts` | `AgentRunLifecycle` | type | `apps/desktop/test/readonly-panel-stale-guard.test.ts`<br>`apps/desktop/test/use-agent-run-lifecycle.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `applyAnnotateHighlights` | function | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `clearAnnotateHighlights` | function | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `collectAnnotateRangeForPreviewSelection` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `getActiveAnnotateHighlightEntries` | function | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `getSelectionOffsetsInElement` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts`<br>`apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `groupAnnotateIdsByOriginalText` | reexport | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `isPreviewAnnotateDomSearchFallbackEnabled` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts`<br>`apps/desktop/test/preview-annotate.test.ts`<br>`apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `parseAnnotateIdsAttr` | reexport | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PREVIEW_ANNOTATE_HIGHLIGHT_NAME` | const | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PREVIEW_ANNOTATE_ID_ATTR` | const | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PREVIEW_ANNOTATE_IDS_ATTR` | const | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `PREVIEW_ANNOTATE_MARK_CLASS` | const | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `readSelectionTextInContainer` | function | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `resolveAnnotateIdsFromClick` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts`<br>`apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `setPreviewAnnotateDomSearchFallbackForTests` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts`<br>`apps/desktop/test/preview-annotate.test.ts`<br>`apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/preview-annotate.ts` | `supportsCssCustomHighlight` | function | `apps/desktop/test/preview-annotate.test.ts` |
| `apps/desktop/renderer/layout/preview-recogito.ts` | `draftToRecogitoAnnotation` | function | `apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/preview-recogito.ts` | `extractRecogitoRenderRange` | function | `apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/preview-recogito.ts` | `hasRecogitoRenderRange` | function | `apps/desktop/test/preview-recogito-md.test.ts` |
| `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts` | `sanitizeAnnotatePreviewHtml` | function | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `ANNOTATE_SOFT_RANGE_CHAR_PADDING` | reexport | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `ANNOTATE_SOFT_RANGE_LINE_PADDING` | reexport | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `buildAnnotateAttachmentFromDraft` | reexport | `apps/desktop/test/rollback-annotate-restore.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `buildAnnotatedSource` | reexport | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `locateAnnotateOffsetRangeByQuoteContext` | reexport | `apps/desktop/test/preview-annotate-source-anchor.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `scanAtPathAttachments` | reexport | `apps/desktop/test/composer-at-path.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `USER_VFS_TURN_ACK_TEXT` | reexport | `apps/desktop/test/message-blocks.test.ts` |
| `apps/desktop/shared/logic/chat.ts` | `wrapUserVfsActionsForStorage` | reexport | `apps/desktop/test/message-blocks.test.ts` |
| `apps/desktop/shared/logic/format.ts` | `formatCharCount` | reexport | `apps/desktop/test/use-agent-stream-metrics.test.ts` |
| `apps/desktop/shared/logic/format.ts` | `formatStreamElapsed` | reexport | `apps/desktop/test/use-agent-stream-metrics.test.ts` |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `onCoreRunFailed` | function | `apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts` |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `onCoreRunFinished` | function | `apps/desktop/test/agent-run-lifecycle.test.ts`<br>`apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts` |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `onCoreRunStarted` | function | `apps/desktop/test/agent-run-lifecycle.test.ts` |
| `apps/desktop/src/main/ipc/handlers/agent.ts` | `registerTrackedRunForTests` | function | `apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts` |
| `apps/desktop/src/main/ipc/handlers/app-info.ts` | `__setAppInfoSeamsForTests` | function | `apps/desktop/test/ipc/app-info.test.ts` |
| `apps/desktop/src/main/ipc/resolve-vfs-scope.ts` | `VfsScopeError` | class | `apps/desktop/test/physical-vfs-ipc.test.ts` |
| `apps/desktop/src/main/runtime/desktop-runtime-singleton.ts` | `resetDesktopRuntimeForTest` | function | `apps/desktop/test/agent-registry-handlers.test.ts`<br>`apps/desktop/test/blob-binary-normalization-service.test.ts`<br>`apps/desktop/test/desktop-db-test-env.ts`<br>`apps/desktop/test/runtime.test.ts` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `chatPromptTokenDebounceExecCountForTests` | function | `apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts`<br>`apps/desktop/test/chat-prompt-tokens.test.ts` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `holdReadWarmInflightForTests` | function | `apps/desktop/test/chat-prompt-tokens.test.ts`<br>`apps/desktop/test/compaction-handler.test.ts` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `loadChatPromptTokenStats` | function | `apps/desktop/test/chat-prompt-tokens.test.ts`<br>`apps/desktop/test/compaction-handler.test.ts` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `resetChatPromptTokenDebounceForTests` | function | `apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts`<br>`apps/desktop/test/chat-prompt-tokens.test.ts` |
| `apps/desktop/src/main/services/chat-prompt-tokens.service.ts` | `withRealFallbackCounter` | function | `apps/desktop/test/chat-prompt-tokens.test.ts` |
| `apps/desktop/src/main/services/cloud-sync.service.ts` | `resetDesktopCloudSyncServiceForTest` | function | `apps/desktop/test/cloud-sync-handlers.test.ts`<br>`apps/desktop/test/db-maintenance-handlers.test.ts` |
| `apps/desktop/src/main/services/cloud-sync.service.ts` | `setDesktopCloudSyncBusyForTest` | function | `apps/desktop/test/db-maintenance-handlers.test.ts` |
| `apps/desktop/src/main/services/db-backup.service.ts` | `exportDatabaseBackupToPath` | function | `apps/desktop/test/db-backup-busy.test.ts` |
| `apps/desktop/src/main/services/db-backup.service.ts` | `importDatabaseBackupFromBytes` | function | `apps/desktop/test/db-backup-busy.test.ts` |
| `apps/desktop/src/main/services/db-backup.service.ts` | `importDatabaseBackupFromPath` | function | `apps/desktop/test/db-backup-busy.test.ts` |
| `apps/desktop/src/main/services/db-maintenance-busy.ts` | `resetDesktopDbMaintenanceBusyForTest` | function | `apps/desktop/test/db-backup-busy.test.ts`<br>`apps/desktop/test/db-maintenance-handlers.test.ts` |
| `apps/desktop/src/main/services/message-content-compaction.service.ts` | `runDesktopMessageContentCompactionLoop` | function | `apps/desktop/test/message-content-compaction-service.test.ts` |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `resolveDragIconForTest` | function | `apps/desktop/test/vfs-batch-staging.test.ts` |
| `apps/desktop/src/main/services/vfs-batch.service.ts` | `stagingTtlCountForTest` | function | `apps/desktop/test/vfs-batch-staging.test.ts` |
| `apps/mobile/src/components/agent/prompt-collapse.ts` | `PROMPT_INLINE_MAX_LINES` | const | `apps/mobile/__tests__/expandable-prompt-input.test.tsx` |
| `apps/mobile/src/components/agent/prompt-macro-input.ts` | `splitPromptMacroSegments` | function | `apps/mobile/__tests__/prompt-macro-input.test.ts` |
| `apps/mobile/src/components/agent/prompt-macro-input.ts` | `tryAtomicMacroDelete` | function | `apps/mobile/__tests__/atomic-range-delete.test.ts`<br>`apps/mobile/__tests__/prompt-macro-input.test.ts` |
| `apps/mobile/src/components/chat/AttachmentDraftChips.tsx` | `formatAttachmentChipLabel` | function | `apps/mobile/__tests__/attachment-draft-chips.test.ts` |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `CHAT_TRANSCRIPT_BRIDGE_VERSION` | const | `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-bridge.test.ts`<br>`apps/mobile/__tests__/chat-transcript-snapshot-after-stream-commit.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-bytes.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-complete-signal.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-stream-block.test.ts`<br>`apps/mobile/__tests__/chat-transcript-webview.test.tsx` |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION` | reexport | `apps/mobile/__tests__/chat-transcript-bridge.test.ts`<br>`apps/mobile/__tests__/chat-transcript-scroll-cache.test.ts`<br>`apps/mobile/__tests__/scope-cache-lru-bound.test.ts`<br>`apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `decodeHostToTranscript` | function | `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-bridge.test.ts`<br>`apps/mobile/__tests__/chat-transcript-snapshot-after-stream-commit.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-bytes.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-complete-signal.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-webview.test.tsx` |
| `apps/mobile/src/components/chat/ChatTranscriptBridge.ts` | `encodeTranscriptToHost` | function | `apps/mobile/__tests__/chat-transcript-bridge.test.ts` |
| `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx` | `planSnapshotChunkBounds` | function | `apps/mobile/__tests__/chat-transcript-snapshot-bytes.test.tsx` |
| `apps/mobile/src/components/chat/composer-at-path.ts` | `countScannedAtPathAttachments` | reexport | `apps/mobile/__tests__/composer-at-path.test.tsx` |
| `apps/mobile/src/components/chat/composer-at-path.ts` | `replaceActiveAtWithToken` | reexport | `apps/mobile/__tests__/composer-at-path.test.tsx` |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `ComposerInputInitPayload` | type | `apps/mobile/__tests__/prompt-macro-text-input.test.tsx` |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `decodeHostToComposerInput` | function | `apps/mobile/__tests__/chat-composer.integration.test.tsx`<br>`apps/mobile/__tests__/composer-at-path.test.tsx`<br>`apps/mobile/__tests__/composer-fullscreen.test.tsx`<br>`apps/mobile/__tests__/composer-input-bridge.test.ts`<br>`apps/mobile/__tests__/composer-input-webview.test.tsx`<br>`apps/mobile/__tests__/prompt-macro-text-input.test.tsx` |
| `apps/mobile/src/components/chat/ComposerInputBridge.ts` | `encodeComposerInputToHost` | function | `apps/mobile/__tests__/composer-input-bridge.test.ts` |
| `apps/mobile/src/components/chat/enrich-transcript-rows.ts` | `clearRichHtmlCacheForTests` | function | `apps/mobile/__tests__/enrich-transcript-rows-lru.test.ts` |
| `apps/mobile/src/components/chat/FileReferencePicker.tsx` | `atPathTokensFromPickerSelection` | reexport | `apps/mobile/__tests__/file-reference-picker.test.tsx` |
| `apps/mobile/src/components/chat/FileReferencePicker.tsx` | `listPickerChildRows` | function | `apps/mobile/__tests__/file-reference-picker.test.tsx` |
| `apps/mobile/src/components/chat/flush-run-ui.ts` | `flushAgentStepUi` | function | `apps/mobile/__tests__/flush-run-ui.test.ts` |
| `apps/mobile/src/components/chat/flush-run-ui.ts` | `flushRunUi` | function | `apps/mobile/__tests__/flush-run-ui.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `BuildChatListItemsOptions` | interface | `apps/mobile/__tests__/build-transcript-rows.test.ts`<br>`apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `buildToolResultByUseId` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `isDisplayableAttachment` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `isTurnToolExecuting` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `toolCallViewFromUse` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `toolUseIdsFromMessage` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-blocks.ts` | `turnToolResultsComplete` | function | `apps/mobile/__tests__/message-blocks.test.ts` |
| `apps/mobile/src/components/chat/message-edit.ts` | `isSetFloorEligibleMessage` | function | `apps/mobile/__tests__/message-action-items.test.ts` |
| `apps/mobile/src/components/chat/tool-turn-actions.ts` | `deleteToolTurn` | function | `apps/mobile/__tests__/tool-turn-actions.test.ts` |
| `apps/mobile/src/components/chat/tool-turn-actions.ts` | `hideToolTurn` | function | `apps/mobile/__tests__/tool-turn-actions.test.ts` |
| `apps/mobile/src/components/provider/ProviderForm.tsx` | `EMPTY_PROVIDER_FORM` | const | `apps/mobile/__tests__/provider-form.test.tsx` |
| `apps/mobile/src/components/provider/ProviderForm.tsx` | `parseBodyParamsJson` | function | `apps/mobile/__tests__/provider-form.test.tsx` |
| `apps/mobile/src/components/rich-content/highlight-code.ts` | `LANG_ALIAS` | const | `apps/mobile/__tests__/code-block-render.test.tsx`<br>`apps/mobile/__tests__/decode-entities-parity.test.ts` |
| `apps/mobile/src/components/rich-content/rich-content-limits.ts` | `RICH_CONTENT_MAX_CHARS` | const | `apps/mobile/__tests__/code-block-render.test.tsx`<br>`apps/mobile/__tests__/FileMarkdownPreview.test.tsx`<br>`apps/mobile/__tests__/prepare-stream-tail-html.test.ts`<br>`apps/mobile/__tests__/rich-content-limits.test.ts`<br>`apps/mobile/__tests__/stream-block-split.test.ts` |
| `apps/mobile/src/components/rich-content/rich-content-limits.ts` | `RICH_DOCUMENT_WEBVIEW_MAX_CHARS` | const | `apps/mobile/__tests__/FileMarkdownPreview.test.tsx`<br>`apps/mobile/__tests__/rich-content-limits.test.ts` |
| `apps/mobile/src/components/rich-content/sanitize-rich-html.ts` | `filterInlineStyle` | function | `apps/mobile/__tests__/sanitize-rich-html.test.ts` |
| `apps/mobile/src/components/vfs/CodeEditorBridge.ts` | `CODE_EDITOR_BRIDGE_VERSION` | const | `apps/mobile/__tests__/code-editor-bridge.test.ts` |
| `apps/mobile/src/components/vfs/CodeEditorBridge.ts` | `decodeHostToCodeEditor` | function | `apps/mobile/__tests__/code-editor-bridge.test.ts` |
| `apps/mobile/src/components/vfs/CodeEditorBridge.ts` | `encodeCodeEditorToHost` | function | `apps/mobile/__tests__/code-editor-bridge.test.ts` |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `decodeHostToRichDocument` | function | `apps/mobile/__tests__/rich-document-bridge.test.ts` |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `encodeRichDocumentToHost` | function | `apps/mobile/__tests__/rich-document-bridge.test.ts` |
| `apps/mobile/src/components/vfs/RichDocumentBridge.ts` | `RICH_DOCUMENT_BRIDGE_VERSION` | const | `apps/mobile/__tests__/rich-document-bridge.test.ts` |
| `apps/mobile/src/components/vfs/RichDocumentWebView.tsx` | `RICH_DOCUMENT_ANNOTATE_MENU_ITEMS` | const | `apps/mobile/__tests__/rich-document-webview-annotate-menu.test.tsx` |
| `apps/mobile/src/components/vfs/vfs-row-mapper.ts` | `mapVfsFilePath` | function | `apps/mobile/__tests__/vfs-row-mapper.test.ts` |
| `apps/mobile/src/db/db-file-path.ts` | `buildMobileDatabaseFilePathCandidates` | function | `apps/mobile/__tests__/connection.test.ts` |
| `apps/mobile/src/db/db-file-path.ts` | `getMobileDatabaseFilePath` | function | `apps/mobile/__tests__/connection.test.ts` |
| `apps/mobile/src/db/db-file-path.ts` | `QUICK_SQLITE_DEFAULT_LOCATION` | const | `apps/mobile/__tests__/connection.test.ts` |
| `apps/mobile/src/hooks/useAndroidChatBackHandler.ts` | `AndroidChatBackActions` | type | `apps/mobile/__tests__/use-android-chat-back-handler.test.ts` |
| `apps/mobile/src/hooks/useAndroidChatBackHandler.ts` | `AndroidChatBackState` | type | `apps/mobile/__tests__/use-android-chat-back-handler.test.ts` |
| `apps/mobile/src/navigation/ChatTabNavContext.tsx` | `ChatTabNavigationContextValue` | type | `apps/mobile/__tests__/app-header.test.tsx` |
| `apps/mobile/src/navigation/HeaderContext.tsx` | `HeaderOverride` | interface | `apps/mobile/__tests__/app-header.test.tsx` |
| `apps/mobile/src/runtime/agent-activity.ts` | `setMobileAgentActive` | function | `apps/mobile/__tests__/agent-activity.test.ts`<br>`apps/mobile/__tests__/chat-composer.integration.test.tsx`<br>`apps/mobile/__tests__/chat-stream-metrics-bar-live.test.tsx`<br>`apps/mobile/__tests__/run-finish-calibration-probe.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-final-rate.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-manager.service.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-messages.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-pipeline.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-s6-wiring.test.ts`<br>`apps/mobile/__tests__/subagent-session-screen-metrics.test.tsx` |
| `apps/mobile/src/runtime/novel-master-context.tsx` | `createNotificationPrefBridge` | function | `apps/mobile/__tests__/keepalive-resident-boot.test.ts` |
| `apps/mobile/src/runtime/novel-master-context.tsx` | `ensureKeepAliveResidentBoot` | function | `apps/mobile/__tests__/keepalive-resident-boot.test.ts` |
| `apps/mobile/src/screens/stack/token-usage/format.ts` | `localDayKeyOffset` | function | `apps/mobile/__tests__/token-usage-format.test.ts`<br>`apps/mobile/__tests__/token-usage-stats-screen.test.tsx` |
| `apps/mobile/src/screens/tabs/chat-tab/chat-link-nav.ts` | `ChatLinkProbeVfs` | type | `apps/mobile/__tests__/chat-link-nav.test.ts` |
| `apps/mobile/src/services/agent-finished-notification.ts` | `resetAgentNotificationPermissionStateForTests` | function | `apps/mobile/__tests__/agent-finished-notification.test.ts` |
| `apps/mobile/src/services/agent-finished-notification.ts` | `resetFailedNotifyMergeStateForTests` | function | `apps/mobile/__tests__/agent-finished-notification.test.ts` |
| `apps/mobile/src/services/agent-finished-notification.ts` | `resetKeepAliveStateForTests` | function | `apps/mobile/__tests__/agent-finished-notification.test.ts`<br>`apps/mobile/__tests__/keepalive-resident-boot.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-manager.service.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-messages.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-pipeline.test.ts` |
| `apps/mobile/src/services/agent-yaml.service.ts` | `decodeAgentYamlText` | function | `apps/mobile/__tests__/agent-yaml.service.test.ts` |
| `apps/mobile/src/services/chat-list-scroll-cache.ts` | `clearAllScrollSnapshots` | function | `apps/mobile/__tests__/chat-tab-screen-legacy-scroll.test.tsx`<br>`apps/mobile/__tests__/scope-cache-lru-bound.test.ts`<br>`apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` |
| `apps/mobile/src/services/chat-list-scroll-cache.ts` | `scrollSnapshotCacheSize` | function | `apps/mobile/__tests__/scope-cache-lru-bound.test.ts` |
| `apps/mobile/src/services/chat-prompt-tokens.service.ts` | `loadChatPromptTokenLabel` | function | `apps/mobile/__tests__/chat-prompt-tokens.test.ts` |
| `apps/mobile/src/services/chat-session-view-cache.ts` | `clearAllSessionViewCaches` | function | `apps/mobile/__tests__/chat-session-view-cache.test.ts`<br>`apps/mobile/__tests__/chat-tab-messages-scope.test.tsx`<br>`apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`<br>`apps/mobile/__tests__/scope-cache-lru-bound.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-messages.test.ts`<br>`apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` |
| `apps/mobile/src/services/chat-session-view-cache.ts` | `sessionViewCacheSize` | function | `apps/mobile/__tests__/scope-cache-lru-bound.test.ts` |
| `apps/mobile/src/services/chat-transcript-scroll-cache.ts` | `clearAllTranscriptScrollSnapshots` | function | `apps/mobile/__tests__/chat-transcript-scroll-cache.test.ts`<br>`apps/mobile/__tests__/scope-cache-lru-bound.test.ts`<br>`apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` |
| `apps/mobile/src/services/chat-transcript-scroll-cache.ts` | `scrollCacheKey` | function | `apps/mobile/__tests__/scope-cache-lru-bound.test.ts`<br>`apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts` |
| `apps/mobile/src/services/chat-transcript-scroll-cache.ts` | `transcriptScrollSnapshotCacheSize` | function | `apps/mobile/__tests__/scope-cache-lru-bound.test.ts` |
| `apps/mobile/src/services/chat-transcript-telemetry.ts` | `CHAT_TRANSCRIPT_TELEMETRY_ENABLED` | const | `apps/mobile/__tests__/chat-transcript-telemetry.test.ts` |
| `apps/mobile/src/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_KKV_MODULE` | const | `apps/mobile/__tests__/cloud-sync-config.store.test.ts` |
| `apps/mobile/src/services/cloud-sync-config.store.ts` | `CLOUD_SYNC_SECRET_REF` | const | `apps/mobile/__tests__/cloud-sync-config.service.integration.test.ts`<br>`apps/mobile/__tests__/cloud-sync-config.store.test.ts` |
| `apps/mobile/src/services/cloud-sync-config.store.ts` | `generateCloudSyncDeviceId` | function | `apps/mobile/__tests__/cloud-sync-config.store.test.ts` |
| `apps/mobile/src/services/cloud-sync-config.store.ts` | `readCloudSyncSecretKey` | function | `apps/mobile/__tests__/cloud-sync-config.store.test.ts` |
| `apps/mobile/src/services/cloud-sync-config.store.ts` | `setCloudSyncConfig` | function | `apps/mobile/__tests__/cloud-sync-config.store.test.ts` |
| `apps/mobile/src/services/cloud-sync-progress-log.ts` | `shortStorageKey` | function | `apps/mobile/__tests__/cloud-sync-progress-log.test.ts` |
| `apps/mobile/src/services/cloud-sync-progress-ui.ts` | `initialCloudSyncProgressUi` | function | `apps/mobile/__tests__/cloud-sync-progress-log.test.ts` |
| `apps/mobile/src/services/cloud-sync.service.ts` | `sha256Hex` | reexport | `apps/mobile/__tests__/cloud-sync.service.test.ts` |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | `createNativeRequestFetch` | function | `apps/mobile/__tests__/llm-native-fetch-shim.test.ts` |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | `LLM_NATIVE_FETCH_CALL_TIMEOUT_MS` | const | `apps/mobile/__tests__/llm-native-fetch-shim.test.ts` |
| `apps/mobile/src/services/llm-native-fetch-shim.ts` | `LlmNativeRequestFn` | type | `apps/mobile/__tests__/llm-native-fetch-shim.test.ts` |
| `apps/mobile/src/services/run-finish-calibration-probe.ts` | `RUN_FINISH_CALIBRATION_INTERVAL_MS` | const | `apps/mobile/__tests__/run-finish-calibration-probe.test.ts` |
| `apps/mobile/src/services/run-finish-calibration-probe.ts` | `RUN_FINISH_CALIBRATION_RECONFIRM_DELAY_MS` | const | `apps/mobile/__tests__/run-finish-calibration-probe.test.ts` |
| `apps/mobile/src/services/run-state-writethrough.ts` | `RUN_STATE_WRITETHROUGH_INTERVAL_MS` | const | `apps/mobile/__tests__/session-stream-unit-persist.test.ts` |
| `apps/mobile/src/services/run-state-writethrough.ts` | `RUN_STATE_WRITETHROUGH_SLOW_INTERVAL_MS` | const | `apps/mobile/__tests__/session-stream-unit-persist.test.ts` |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SESSION_STREAM_MAX_SETTLED_UNITS` | const | `apps/mobile/__tests__/session-stream-unit-manager.service.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts` |
| `apps/mobile/src/services/session-stream-unit-manager.service.ts` | `SessionStreamRunStateStore` | interface | `apps/mobile/__tests__/session-stream-unit-final-rate.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts` |
| `apps/mobile/src/services/session-stream-unit.ts` | `SESSION_STREAM_APPLY_INTERVAL_MS` | const | `apps/mobile/__tests__/session-stream-unit-accum-perf.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-messages.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-pipeline.test.ts` |
| `apps/mobile/src/services/session-stream-unit.ts` | `SESSION_STREAM_INGRESS_COALESCE_MS` | const | `apps/mobile/__tests__/session-stream-unit-accum-perf.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-messages.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-persist.test.ts`<br>`apps/mobile/__tests__/session-stream-unit-pipeline.test.ts` |
| `apps/mobile/src/services/session-stream-unit.ts` | `SESSION_STREAM_SETTLED_GRACE_PERIOD_MS` | const | `apps/mobile/__tests__/session-stream-unit-manager.service.test.ts` |
| `apps/mobile/src/services/stream-token-estimator.ts` | `createStreamTokenEstimator` | function | `apps/mobile/__tests__/stream-token-estimator.test.ts` |
| `apps/mobile/src/services/stream-token-estimator.ts` | `resolveStreamTokenEncodingName` | function | `apps/mobile/__tests__/stream-token-estimator.test.ts` |
| `apps/mobile/src/services/stream-token-estimator.ts` | `StreamTokenModelHintRuntime` | interface | `apps/mobile/__tests__/stream-token-estimator.test.ts` |
| `apps/mobile/src/services/vfs-zip.service.ts` | `zipBaseNameFromPath` | function | `apps/mobile/__tests__/vfs-zip.service.test.ts` |
| `apps/mobile/src/theme/tokens.ts` | `darkTheme` | const | `apps/mobile/__tests__/composer-at-path.test.tsx` |
| `apps/mobile/src/theme/tokens.ts` | `lightTheme` | const | `apps/mobile/__tests__/composer-at-path.test.tsx`<br>`apps/mobile/__tests__/expandable-prompt-input.test.tsx`<br>`apps/mobile/__tests__/main-tab-bar-style.test.ts`<br>`apps/mobile/__tests__/prompt-macro-text-input.test.tsx` |
| `apps/mobile/src/vfs/errors.ts` | `formatVfsError` | reexport | `apps/mobile/__tests__/errors.test.ts` |
| `apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx` | `splitRefTokenSpans` | function | `apps/mobile/__tests__/chat-transcript-ref-token.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `atomicDeleteRanges` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `renderHighlightHtml` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `resolveAtomicCaret` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `resolveAtomicDelete` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `resolveReportedHeight` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `resolveUnbounded` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/composer-input/webview/runtime/editor.ts` | `shouldReportChange` | function | `apps/mobile/__tests__/composer-input-dom.test.ts` |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts` | `collectAnnotateSelection` | function | `apps/mobile/__tests__/annotate-source-anchor-collect.test.tsx` |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts` | `getSelectionOffsetsInElement` | function | `apps/mobile/__tests__/annotate-source-anchor-collect.test.tsx` |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-collect.ts` | `reportRecogitoCreateFromSelection` | function | `apps/mobile/__tests__/annotate-source-anchor-collect.test.tsx` |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-recogito-map.ts` | `draftToRecogitoAnnotation` | function | `apps/mobile/__tests__/annotate-recogito-preview.test.tsx` |
| `apps/mobile/src/web/rich-document/webview/runtime/annotate-recogito-map.ts` | `recogitoAnnotationToDraftFields` | function | `apps/mobile/__tests__/annotate-recogito-preview.test.tsx` |
| `apps/mobile/src/web/rich-document/webview/runtime/document-model.ts` | `concatDocBodyHtml` | function | `apps/mobile/__tests__/rich-document-doc-body-concat.test.ts` |
| `apps/mobile/src/web/shared/decode-entities.ts` | `decodeAfterSanitize` | function | `apps/mobile/__tests__/decode-entities-parity.test.ts` |
| `apps/mobile/src/web/shared/decode-entities.ts` | `decodeForMarkdownInput` | function | `apps/mobile/__tests__/decode-entities-parity.test.ts` |
| `apps/mobile/src/web/shared/host-message-channel.ts` | `parseHostMessage` | function | `apps/mobile/__tests__/web-host-message.test.ts` |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `extractMermaidErrorMessage` | function | `apps/mobile/__tests__/mermaid-webview.test.ts` |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `inferMermaidThemeFromBg` | function | `apps/mobile/__tests__/mermaid-webview.test.ts` |
| `apps/mobile/src/web/shared/mermaid-core.ts` | `parseColorToRgb` | reexport | `apps/mobile/__tests__/mermaid-webview.test.ts` |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `clampMermaidViewerScale` | function | `apps/mobile/__tests__/mermaid-fullscreen.test.ts` |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `MERMAID_VIEWER_DOUBLE_TAP_SCALE` | const | `apps/mobile/__tests__/mermaid-fullscreen.test.ts` |
| `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures.ts` | `MERMAID_VIEWER_MAX_SCALE` | const | `apps/mobile/__tests__/mermaid-fullscreen.test.ts` |
| `apps/mobile/src/web/shared/rich-content-styles.ts` | `buildRichContentCssRules` | function | `apps/mobile/__tests__/code-block-render.test.tsx`<br>`apps/mobile/__tests__/rich-content-styles.test.ts` |
| `apps/mobile/src/web/shared/rich-content-styles.ts` | `CHAT_TRANSCRIPT_RICH_CSS` | const | `apps/mobile/__tests__/mermaid-webview.test.ts`<br>`apps/mobile/__tests__/rich-content-styles.test.ts` |
| `apps/mobile/src/web/shared/rich-content-styles.ts` | `RICH_DOCUMENT_RICH_CSS` | const | `apps/mobile/__tests__/mermaid-webview.test.ts`<br>`apps/mobile/__tests__/rich-content-styles.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` | `LONG_PRESS_MOVE_TOLERANCE_PX` | reexport | `apps/mobile/__tests__/menu-overlay-guards.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` | `MENU_OPEN_GRACE_MS` | reexport | `apps/mobile/__tests__/menu-overlay-guards.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` | `shouldCancelLongPressForMove` | function | `apps/mobile/__tests__/menu-overlay-guards.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/menu-overlay-guards.ts` | `shouldIgnoreMenuOutsideDismiss` | function | `apps/mobile/__tests__/menu-overlay-guards.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `clampScrollTop` | function | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `NEAR_BOTTOM_THRESHOLD_PX` | reexport | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `nearBottom` | function | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `offsetFromBottom` | function | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `scrollTopAfterPrepend` | function | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/scroll.ts` | `scrollTopForBottom` | function | `apps/mobile/__tests__/chat-transcript-scroll.test.ts` |
| `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts` | `nextStreamTailHtmlField` | function | `apps/mobile/__tests__/stream-tail-html-state.test.ts` |
| `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `__setKeyboardHeightForTests` | function | `apps/mobile/__tests__/use-adaptive-keyboard-sheet-style.test.ts` |
| `apps/mobile/test-utils/react-native-webview-mock.tsx` | `clearMockWebViewPostMessages` | function | `apps/mobile/__tests__/chat-composer.integration.test.tsx`<br>`apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-after-stream-commit.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-bytes.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-complete-signal.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-webview.test.tsx`<br>`apps/mobile/__tests__/composer-at-path.test.tsx`<br>`apps/mobile/__tests__/composer-fullscreen.test.tsx`<br>`apps/mobile/__tests__/composer-input-webview.test.tsx`<br>`apps/mobile/__tests__/prompt-macro-text-input.test.tsx` |
| `apps/mobile/test-utils/react-native-webview-mock.tsx` | `mockWebViewPostMessages` | const | `apps/mobile/__tests__/chat-composer.integration.test.tsx`<br>`apps/mobile/__tests__/chat-tab-screen.integration.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-after-stream-commit.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-bytes.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-snapshot-complete-signal.test.tsx`<br>`apps/mobile/__tests__/chat-transcript-webview.test.tsx`<br>`apps/mobile/__tests__/composer-at-path.test.tsx`<br>`apps/mobile/__tests__/composer-fullscreen.test.tsx`<br>`apps/mobile/__tests__/composer-input-webview.test.tsx`<br>`apps/mobile/__tests__/prompt-macro-text-input.test.tsx` |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `assertMinimumBaseline` | function | `packages/core/test/bootstrap/baseline-check.test.ts` |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `BASELINE_MIGRATION_IDS` | const | `packages/core/test/bootstrap/baseline-check.test.ts`<br>`packages/core/test/bootstrap/schema-align-columns.test.ts`<br>`packages/core/test/chat/sqlite-session.repository.test.ts` |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `BASELINE_TOO_OLD_MESSAGE` | const | `packages/core/test/bootstrap/baseline-check.test.ts`<br>`packages/core/test/db-backup/provider-table-snapshot.test.ts` |
| `packages/core/src/bootstrap/novel-master-bootstrap.ts` | `SCHEMA_BOOT_VERSION` | const | `packages/core/test/bootstrap/rename-smart-sort-rule-example-v1.test.ts`<br>`packages/core/test/bootstrap/workplace-dir-rule-smart-field-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/add-mcp-file-path-snapshot-v1.ts` | `ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID` | const | `packages/core/test/bootstrap/add-mcp-file-path-snapshot-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/add-mcp-file-path-snapshot-v1.ts` | `addMcpFilePathSnapshotV1Up` | function | `packages/core/test/bootstrap/add-mcp-file-path-snapshot-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/add-smart-sort-capture-kind-v1.ts` | `ADD_SMART_SORT_CAPTURE_KIND_V1_ID` | const | `packages/core/test/bootstrap/add-smart-sort-capture-kind-v1.test.ts`<br>`packages/core/test/bootstrap/rename-smart-sort-rule-example-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/add-smart-sort-capture-kind-v1.ts` | `addSmartSortCaptureKindV1Up` | function | `packages/core/test/bootstrap/add-smart-sort-capture-kind-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts` | `DEDUP_FILE_CACHE_STORAGE_V1_ID` | const | `packages/core/test/bootstrap/dedup-file-cache-storage-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/dedup-file-cache-storage-v1.ts` | `dedupFileCacheStorageV1Up` | function | `packages/core/test/bootstrap/dedup-file-cache-storage-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/index.ts` | `SCHEMA_MIGRATIONS` | const | `packages/core/test/bootstrap/add-mcp-file-path-snapshot-v1.test.ts`<br>`packages/core/test/bootstrap/add-smart-sort-capture-kind-v1.test.ts`<br>`packages/core/test/bootstrap/bootstrap-no-migrate.test.ts`<br>`packages/core/test/bootstrap/dedup-file-cache-storage-v1.test.ts`<br>`packages/core/test/bootstrap/rename-smart-sort-rule-example-v1.test.ts`<br>`packages/core/test/bootstrap/retire-pref-session-fs-version-check.test.ts`<br>`packages/core/test/bootstrap/workplace-dir-rule-smart-field-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/rename-smart-sort-rule-example-v1.ts` | `RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID` | const | `packages/core/test/bootstrap/rename-smart-sort-rule-example-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/rename-smart-sort-rule-example-v1.ts` | `renameSmartSortRuleExampleV1Up` | function | `packages/core/test/bootstrap/rename-smart-sort-rule-example-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/retire-pref-session-fs-version-check-v1.ts` | `RETIRE_PREF_SESSION_FS_VERSION_CHECK_V1_ID` | const | `packages/core/test/bootstrap/retire-pref-session-fs-version-check.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/workplace-dir-rule-smart-field-v1.ts` | `WORKPLACE_DIR_RULE_SMART_FIELD_V1_ID` | const | `packages/core/test/bootstrap/workplace-dir-rule-smart-field-v1.test.ts` |
| `packages/core/src/bootstrap/schema-migrations/workplace-dir-rule-smart-field-v1.ts` | `workplaceDirRuleSmartFieldV1Up` | function | `packages/core/test/bootstrap/workplace-dir-rule-smart-field-v1.test.ts` |
| `packages/core/src/bootstrap/skills/seed-builtin-skills.ts` | `AGENT_CONFIG_SKILL_MD` | const | `packages/core/test/bootstrap/seed-builtin-skills.test.ts` |
| `packages/core/src/common/format-token-count.ts` | `formatPromptTokenUsageLabel` | const | `packages/core/test/infra/tokenizer/format-token-source-badge.test.ts` |
| `packages/core/src/common/index.ts` | `formatPromptTokenUsageLabel` | reexport | `apps/mobile/__tests__/format-token-count.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `buildAgentDefinitionFromForm` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `buildToolsPolicyFromSelection` | reexport | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `countEffectiveFormPromptSources` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `countFormPromptSources` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `countMinimumPromptSources` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `DEFAULT_WORKPLACE_ASSISTANT_TEXT` | reexport | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `definitionToForm` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `formSnapshotJson` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `hasAnyPromptRegionEnabled` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `isDynamicBlockPersistent` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `movePersistBlock` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `PROMPT_REGION_LABELS` | const | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `splitPersistBlocksForEditor` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `toolsSelectionFromDefinition` | reexport | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `withDynamicBlockPersistence` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `withWorkplaceToggle` | function | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `WORKPLACE_ASSISTANT_TEXT_REQUIRED_MESSAGE` | const | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `WORKPLACE_BLOCK_HINT` | const | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-editor-state.ts` | `WORKPLACE_DISABLED_HINT` | const | `packages/core/test/config-forms/agent-editor-state.test.ts` |
| `packages/core/src/config-forms/agent/agent-tool-catalog.ts` | `BUILTIN_TOOL_CATALOG` | const | `packages/core/test/config-forms/agent-tool-catalog.test.ts` |
| `packages/core/src/config-forms/shared/ui-labels.ts` | `API_KEY_STATUS_LABELS` | const | `packages/core/test/config-forms/ui-labels.test.ts` |
| `packages/core/src/config-forms/stored-config-validity/assess-agent-definition-wire.ts` | `resolveAgentDefinitionFromStorage` | function | `packages/core/test/prompt/workplace-layout-c0.test.ts` |
| `packages/core/src/config-forms/stored-config-validity/index.ts` | `resolveAgentDefinitionFromStorage` | reexport | `packages/core/test/config-forms/stored-config-validity.test.ts`<br>`packages/core/test/prompt/normalize-agent-prompt-layout.test.ts` |
| `packages/core/src/domain/agent/logic/resolve-saved-model-id.ts` | `resolveSummarySavedModelId` | function | `packages/core/test/agent/resolve-saved-model-id.test.ts` |
| `packages/core/src/domain/chat/logic/annotate-source-anchor.ts` | `escapeAnnotateSourceText` | function | `packages/core/test/chat/annotate-source-anchor.test.ts` |
| `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts` | `buildFileAnnotateAttachmentFromDraft` | function | `packages/core/test/chat/annotate-render-range-schema.test.ts`<br>`packages/core/test/chat/annotate-soft-range-schema.test.ts`<br>`packages/core/test/chat/annotate-source-anchor.test.ts`<br>`packages/core/test/service/agent/annotate-drafts-send.test.ts` |
| `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts` | `formatAnnotateLocationLabel` | function | `packages/core/test/service/agent/annotate-drafts-send.test.ts` |
| `packages/core/src/domain/chat/logic/composer-chip-attachment.ts` | `ComposerChipAttachment` | type | `packages/core/test/chat/composer-chip-attachment.test.ts` |
| `packages/core/src/domain/chat/logic/compute-stream-tail-generating.ts` | `computeStreamTailGenerating` | function | `packages/core/test/chat/compute-stream-tail-generating.test.ts` |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `diffWorkspaceForUserVfsFlush` | function | `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts` |
| `packages/core/src/domain/chat/logic/diff-workspace-for-user-vfs-flush.ts` | `isWorkspaceFlushDiffEmpty` | function | `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts` |
| `packages/core/src/domain/chat/logic/merge-pending-vfs-turns.ts` | `mergePendingVfsTurns` | function | `packages/core/test/chat/merge-pending-vfs-turns.test.ts` |
| `packages/core/src/domain/chat/logic/message-visible-floor.ts` | `visibleFloorByMessageId` | function | `packages/core/test/chat/message-visible-floor.test.ts` |
| `packages/core/src/domain/chat/logic/prompt-path-seen.ts` | `PROMPT_FILE_SEEN_SHORT_TIP` | const | `packages/core/test/chat/prepare-user-messages-for-prompt.test.ts` |
| `packages/core/src/domain/chat/logic/resolve-chat-link-target.ts` | `elideChatLinkPath` | function | `packages/core/test/chat/resolve-chat-link-target.test.ts` |
| `packages/core/src/domain/chat/logic/status-chip-label.ts` | `formatStatusChipLabel` | function | `packages/core/test/chat/status-chip-label.test.ts` |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `buildUserVfsTurnView` | function | `packages/core/test/chat/user-vfs-turn-view.test.ts` |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `matchUserVfsTurnAt` | function | `packages/core/test/chat/user-vfs-turn-view.test.ts` |
| `packages/core/src/domain/chat/logic/user-vfs-turn-view.ts` | `USER_VFS_TURN_ACK_TEXT` | reexport | `packages/core/test/chat/user-vfs-turn-view.test.ts` |
| `packages/core/src/domain/chat/logic/workspace-flush-snapshot.ts` | `deriveDirPathsFromFileTree` | function | `packages/core/test/chat/diff-workspace-for-user-vfs-flush.test.ts` |
| `packages/core/src/domain/chat/model/annotate-draft.schema.ts` | `annotateDraftSchema` | const | `packages/core/test/chat/annotate-render-range-schema.test.ts`<br>`packages/core/test/chat/annotate-soft-range-schema.test.ts`<br>`packages/core/test/chat/annotate-source-anchor.test.ts` |
| `packages/core/src/domain/chat/model/composer-draft.schema.ts` | `composerDraftSchema` | const | `packages/core/test/chat/composer-draft.schema.test.ts` |
| `packages/core/src/domain/chat/model/message-attachment.schema.ts` | `NO_PATH_ATTACHMENT_NAME` | const | `packages/core/test/chat/message-attachment.schema.test.ts` |
| `packages/core/src/domain/chat/model/user-vfs-pending.schema.ts` | `userVfsPendingEntrySchema` | const | `packages/core/test/chat/user-vfs-pending.schema.test.ts` |
| `packages/core/src/domain/chat/model/user-vfs-pending.schema.ts` | `userVfsPendingQueueSchema` | const | `packages/core/test/chat/user-vfs-pending.schema.test.ts` |
| `packages/core/src/domain/compaction-conditions/logic/token-estimate.ts` | `estimateTokens` | function | `packages/core/test/infra/tokenizer/heuristic-token-counter.test.ts` |
| `packages/core/src/domain/depth/logic/depth-slice.ts` | `matchDepth` | function | `packages/core/test/depth/depth-slice.test.ts` |
| `packages/core/src/domain/depth/logic/depth-slice.ts` | `validateDepthSlice` | function | `packages/core/test/depth/depth-slice.test.ts` |
| `packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts` | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN` | const | `packages/core/test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts` |
| `packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts` | `resetUserVfsUnifiedToolTurnSnapshotForTests` | function | `packages/core/test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts`<br>`packages/core/test/service/agent/annotate-drafts-send.test.ts`<br>`packages/core/test/service/agent/cli-run-agent-turn-parity.test.ts`<br>`packages/core/test/service/agent/run-agent-turn.test.ts` |
| `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` | `BackfillShortCircuitDecision` | type | `packages/core/test/message-checkpoint/backfill-cursor.test.ts` |
| `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts` | `createBaselineCheckpointBackfillOperation` | function | `packages/core/test/message-checkpoint/rollback-backfill-baseline-op.test.ts` |
| `packages/core/src/domain/message-checkpoint/logic/restore-path.ts` | `RestorePathPrefetch` | type | `packages/core/test/message-checkpoint/rollback-reach-hash-batch.test.ts` |
| `packages/core/src/domain/message-checkpoint/logic/revision-gc.ts` | `revisionReachableKey` | function | `packages/core/test/message-checkpoint/revision-gc.test.ts` |
| `packages/core/src/domain/prompt/logic/validate-prompt-blocks.ts` | `validatePromptBlocks` | const | `packages/core/test/prompt/validate-prompt-blocks.test.ts` |
| `packages/core/src/domain/provider/logic/application-model-id.ts` | `formatApplicationModelId` | function | `packages/core/test/provider/application-model-id.test.ts` |
| `packages/core/src/domain/provider/logic/application-model-id.ts` | `parseApplicationModelId` | function | `packages/core/test/provider/application-model-id.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_KEY_TO_UUID` | const | `packages/core/test/provider/infer-llm-protocol-from-model-id.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_KEYS` | const | `packages/core/test/provider/bootstrap-seed.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUID_ANTHROPIC` | const | `packages/core/test/provider/model-request-tool-use-session.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUID_OPENAI` | const | `packages/core/test/agent/agent-runner-usage.test.ts`<br>`packages/core/test/provider/infer-llm-protocol-from-model-id.test.ts`<br>`packages/core/test/provider/model-request-retry.test.ts`<br>`packages/core/test/provider/model-request-saved-model-settings.test.ts`<br>`packages/core/test/provider/provider-model.service.test.ts`<br>`packages/core/test/provider/provider-service.test.ts`<br>`packages/core/test/provider/resolve-provider-api-key.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUID_OPENCODE` | const | `packages/core/test/provider/provider-service.test.ts`<br>`packages/core/test/provider/resolve-provider-api-key.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_PROVIDER_UUIDS` | const | `packages/core/test/provider/bootstrap-seed.test.ts` |
| `packages/core/src/domain/provider/logic/builtin-providers.ts` | `BUILTIN_UUID_TO_KEY` | const | `packages/core/test/provider/bootstrap-seed.test.ts` |
| `packages/core/src/domain/provider/logic/derive-model-name-from-legacy.ts` | `deriveModelNameFromLegacy` | function | `packages/core/test/provider/derive-model-name-from-legacy.test.ts` |
| `packages/core/src/domain/provider/logic/provider-identity-repair.ts` | `createProviderIdentityRepairOperation` | function | `packages/core/test/provider/provider-identity-repair.test.ts` |
| `packages/core/src/domain/provider/logic/provider-identity-repair.ts` | `createProviderSecretRenameOperation` | function | `packages/core/test/provider/provider-identity-repair.test.ts` |
| `packages/core/src/domain/provider/model/model-thinking-params.schema.ts` | `modelThinkingParamsSchema` | const | `packages/core/test/provider/model-thinking-params.schema.test.ts` |
| `packages/core/src/domain/provider/model/token-counter-mode-options.ts` | `TOKEN_COUNTER_MODE_OPTIONS` | const | `packages/core/test/infra/tokenizer/token-counter-mode-no-public-path.test.ts` |
| `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts` | `SESSION_KKV_DOMAIN_USER_VFS_PENDING` | const | `packages/core/test/character-card/character-card-import.test.ts`<br>`packages/core/test/chat/message-transcript-effects.test.ts`<br>`packages/core/test/chat/sqlite-session.repository.test.ts`<br>`packages/core/test/chat/user-vfs-turn.service.test.ts`<br>`packages/core/test/message-checkpoint/truncate-tail-in-transaction.test.ts`<br>`packages/core/test/vfs/clear-session-prompt-caches.test.ts` |
| `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts` | `USER_VFS_PENDING_QUEUE_KEY` | const | `packages/core/test/chat/message-transcript-effects.test.ts`<br>`packages/core/test/chat/sqlite-session.repository.test.ts`<br>`packages/core/test/chat/user-vfs-turn.service.test.ts`<br>`packages/core/test/message-checkpoint/truncate-tail-in-transaction.test.ts` |
| `packages/core/src/domain/skills/model/skill-name.ts` | `isValidSkillName` | function | `packages/core/test/skills/skill-name.test.ts` |
| `packages/core/src/domain/skills/model/skill-name.ts` | `SKILL_NAME_PATTERN_SOURCE` | const | `packages/core/test/skills/skill-name.test.ts` |
| `packages/core/src/domain/smart-sort-rule/logic/match-smart-sort-pattern.ts` | `SmartSortPatternMatch` | interface | `packages/core/test/smart-sort-rule/match-smart-sort-pattern.test.ts` |
| `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `BuiltinToolSubagentContext` | interface | `packages/core/test/tool/subagent-tool-parallel.test.ts`<br>`packages/core/test/tool/subagent-tool-vfs.test.ts`<br>`packages/core/test/tool/subagent-tool.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/bocha.ts` | `BOCHA_SEARCH_URL` | const | `packages/core/test/tool/search-engines.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/bocha.ts` | `BOCHA_TIMEOUT_MS` | const | `packages/core/test/tool/search-engines.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/brave.ts` | `BRAVE_SEARCH_URL` | const | `packages/core/test/tool/search-engines.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/duckduckgo.ts` | `DUCKDUCKGO_SEARCH_URL` | const | `packages/core/test/tool/duckduckgo.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/duckduckgo.ts` | `DUCKDUCKGO_USER_AGENT` | const | `packages/core/test/tool/duckduckgo.test.ts` |
| `packages/core/src/domain/tool/builtin/search/engines/tavily.ts` | `TAVILY_SEARCH_URL` | const | `packages/core/test/tool/search-engines.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `KEY_ENGINE_ORDER` | const | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `KEY_SEARXNG_BASE_URL` | const | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `normalizeSearxngBaseUrl` | function | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `readSearchConfig` | function | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `resolveEngineChain` | function | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `SEARCH_KKV_MODULE` | const | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `searchApiKeyRef` | function | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-config.ts` | `SearchConfigDeps` | interface | `packages/core/test/tool/search-config.test.ts` |
| `packages/core/src/domain/tool/builtin/search/search-tool.ts` | `SEARCH_TOOL_NAME` | const | `packages/core/test/tool/search-tool.test.ts` |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `SUBAGENT_STOP_REASON_USER` | const | `packages/core/test/tool/subagent-tool.test.ts` |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `TaskToolInput` | interface | `packages/core/test/tool/subagent-tool-vfs.test.ts` |
| `packages/core/src/domain/tool/builtin/subagent-tool.ts` | `TaskToolOutput` | interface | `packages/core/test/tool/subagent-tool-vfs.test.ts` |
| `packages/core/src/domain/tool/builtin/vfs-tools.ts` | `MUTATING_FILE_TOOL_NAMES` | const | `packages/core/test/tool/vfs-tools.test.ts` |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isCurlOutput` | function | `packages/core/test/tool/curl-tool.test.ts`<br>`packages/core/test/tool/format-tool-output.test.ts`<br>`packages/core/test/tool/search-tool.test.ts` |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isGlobOutput` | function | `packages/core/test/tool/curl-tool.test.ts` |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isGrepOutput` | function | `packages/core/test/tool/curl-tool.test.ts` |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isReadOutput` | function | `packages/core/test/tool/curl-tool.test.ts` |
| `packages/core/src/domain/tool/logic/format-tool-output.ts` | `isSearchOutput` | function | `packages/core/test/tool/search-tool.test.ts` |
| `packages/core/src/domain/tool/logic/fs-command.ts` | `isMutatingFsCommand` | function | `packages/core/test/tool/fs-command.test.ts` |
| `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | `resolveSubagentSessionId` | function | `packages/core/test/tool/subagent-meta-passthrough.test.ts` |
| `packages/core/src/domain/tool/logic/tool-output-limits.ts` | `sliceUtf8BytePrefix` | function | `packages/core/test/tool/tool-output-limits.test.ts` |
| `packages/core/src/domain/tool/logic/tool-path-policy.ts` | `extractInputPaths` | function | `packages/core/test/tool/tool-runner-path-policy.test.ts` |
| `packages/core/src/domain/tool/logic/tool-path-policy.ts` | `findDisallowedPath` | function | `packages/core/test/tool/tool-runner-path-policy.test.ts` |
| `packages/core/src/domain/tool/logic/tool-path-policy.ts` | `isPathAllowed` | function | `packages/core/test/tool/tool-runner-path-policy.test.ts` |
| `packages/core/src/domain/tool/logic/tool-path-policy.ts` | `pathStartsWithPrefix` | function | `packages/core/test/tool/tool-runner-path-policy.test.ts` |
| `packages/core/src/domain/tool/logic/tool-path-policy.ts` | `readAllowedPaths` | function | `packages/core/test/tool/tool-runner-path-policy.test.ts` |
| `packages/core/src/domain/tool/logic/tool-use-mutates-workspace.ts` | `toolUseMutatesWorkspace` | function | `packages/core/test/tool/tool-use-mutates-workspace.test.ts` |
| `packages/core/src/domain/vfs/logic/longest-common-substring.ts` | `MAX_LCS_SNIPPET_CHARS` | const | `packages/core/test/vfs/longest-common-substring.test.ts` |
| `packages/core/src/domain/vfs/logic/revision-ref-count.ts` | `createRevisionRefCountRepairOperation` | function | `packages/core/test/vfs/integrity-repair-dual-refcount.test.ts` |
| `packages/core/src/domain/vfs/logic/revision-ref-count.ts` | `repairRefCounts` | function | `packages/core/test/message-checkpoint/rollback-ref-count.test.ts`<br>`packages/core/test/vfs/vfs-repair-ref-count-batch.test.ts` |
| `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts` | `toPhysicalPath` | function | `packages/core/test/chat/fork-copy-parity.test.ts`<br>`packages/core/test/message-checkpoint/blob-gc.test.ts`<br>`packages/core/test/message-checkpoint/rollback-reach-hash-batch.test.ts`<br>`packages/core/test/message-checkpoint/rollback-ref-count.test.ts`<br>`packages/core/test/message-checkpoint/rollback-version-short-circuit.test.ts` |
| `packages/core/src/domain/vfs/logic/vfs-zip-filename-decode.ts` | `ZIP_GPBF_UTF8_EFS` | const | `packages/core/test/vfs/vfs-zip-parse.test.ts` |
| `packages/core/src/domain/vfs/logic/vfs-zip-validate.ts` | `decodeUtf8Entry` | function | `packages/core/test/vfs/vfs-zip-io.test.ts` |
| `packages/core/src/domain/workplace/logic/diff-workplace-paths.ts` | `diffWorkplacePaths` | function | `packages/core/test/workplace/diff-workplace-paths.test.ts` |
| `packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts` | `settlePendingFileCacheBackfills` | function | `packages/core/test/workplace/assemble-abort-fingerprint.test.ts`<br>`packages/core/test/workplace/assemble-backfill-background.test.ts`<br>`packages/core/test/workplace/assemble-workplace-display.test.ts` |
| `packages/core/src/domain/workplace/logic/smart-sort.ts` | `tokenizeNatural` | function | `packages/core/test/smart-sort/smart-sort.test.ts` |
| `packages/core/src/errors/session-fs-errors.ts` | `sessionFsRollbackNoCheckpoint` | function | `apps/desktop/test/format-ipc-error.test.ts` |
| `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts` | `decodedContentCacheStats` | function | `packages/core/test/infra/content-cache/decoded-content-cache.test.ts`<br>`packages/core/test/vfs/content-store-decode-cache.test.ts` |
| `packages/core/src/infra/content-cache/logic/decoded-content-cache.ts` | `DecodedContentPool` | class | `packages/core/test/infra/content-cache/decoded-content-cache.test.ts` |
| `packages/core/src/infra/db-maintenance/impl/blob-binary-normalization.ts` | `__resetStatusSamplingThrottleForTests` | function | `packages/core/test/infra/blob-binary-normalization.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts` | `__resetStatusSamplingThrottleForTests` | function | `packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/impl/message-content-compaction.ts` | `MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY` | const | `packages/core/test/infra/message-content-compaction-maintenance.test.ts`<br>`packages/core/test/infra/message-content-compaction.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `BLOB_BINARY_KKV_MODULE` | reexport | `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`<br>`packages/core/test/infra/blob-binary-normalization.test.ts`<br>`packages/core/test/infra/message-content-compaction-maintenance.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `DbMaintenanceService` | type | `packages/core/test/infra/db-maintenance.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `getMessageCompactionStatus` | reexport | `packages/core/test/infra/message-content-compaction.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `MESSAGE_COMPACTION_KKV_KEY` | reexport | `packages/core/test/chat/message-content-perf-threshold.test.ts`<br>`packages/core/test/infra/message-content-compaction.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `MESSAGE_COMPACTION_KKV_MODULE` | reexport | `packages/core/test/chat/message-content-perf-threshold.test.ts`<br>`packages/core/test/infra/message-content-compaction-maintenance.test.ts`<br>`packages/core/test/infra/message-content-compaction.test.ts`<br>`packages/core/test/infra/status-sampling-throttle.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `MessageCompactionRunResult` | type | `packages/core/test/infra/message-content-compaction.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `RunBlobBinaryNormalizationOptions` | type | `packages/core/test/infra/blob-binary-normalization-maintenance.test.ts`<br>`packages/core/test/infra/blob-binary-normalization.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `runMessageContentCompaction` | reexport | `packages/core/test/chat/message-content-perf-threshold.test.ts`<br>`packages/core/test/infra/message-content-compaction-maintenance.test.ts`<br>`packages/core/test/infra/message-content-compaction.test.ts` |
| `packages/core/src/infra/db-maintenance/index.ts` | `runStartupMaintenanceOnce` | reexport | `packages/core/test/infra/blob-binary-normalization.test.ts`<br>`packages/core/test/infra/message-content-compaction-maintenance.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/anthropic-tool-names.ts` | `toAnthropicWireToolName` | function | `packages/core/test/infra/llm-protocol/anthropic-tool-names.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/debug-fetch.ts` | `redactUrl` | function | `packages/core/test/infra/llm-protocol/debug-fetch.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `resetShouldUseXhrForSseCacheForTests` | function | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-stream-timeout.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `setShouldUseXhrForSseOverrideForTests` | function | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-stream-timeout.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `setSseTransportOverrideForTests` | function | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `shouldUseXhrForSse` | function | `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `SSE_WHOLE_CALL_TIMEOUT_MS` | const | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-stream-timeout.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `SseByteHandler` | type | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts` | `SseTransport` | interface | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/openai-content-mapper.ts` | `blocksToOpenAiMessageContent` | function | `packages/core/test/infra/llm-protocol/openai-content-mapper.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/openai-sse-parser.ts` | `parseOpenAiSseStream` | function | `packages/core/test/infra/llm-protocol/openai-sse-parser.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/registry.ts` | `clearProtocolAdapters` | function | `packages/core/test/provider/model-request-saved-model-settings.test.ts`<br>`packages/core/test/provider/model-request-tool-use-session.test.ts`<br>`packages/core/test/provider/provider-model.service.test.ts`<br>`packages/core/test/provider/provider-service.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts` | `DEFAULT_TICK_MS` | const | `packages/core/test/infra/llm-protocol/llm-sse-transport.test.ts`<br>`packages/core/test/infra/llm-protocol/sse-chunk-emitter.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/sse-parse-errors.ts` | `isSseParseDebugEnabled` | function | `packages/core/test/infra/llm-protocol/sse-parse-errors.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts` | `createStreamWatchdog` | function | `packages/core/test/infra/llm-protocol/stream-watchdog.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/stream-watchdog.ts` | `STREAM_IDLE_TIMEOUT_MS` | const | `packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts`<br>`packages/core/test/infra/llm-protocol/llm-stream-timeout.test.ts`<br>`packages/core/test/infra/llm-protocol/stream-watchdog.test.ts` |
| `packages/core/src/infra/llm-protocol/logic/tool-arguments-parse.ts` | `parseToolArgumentsJson` | function | `packages/core/test/infra/llm-protocol/tool-arguments-parse.test.ts` |
| `packages/core/src/infra/nmtp/logic/registry.ts` | `clearTokenizerDrivers` | function | `packages/core/test/infra/nmtp/registry.test.ts` |
| `packages/core/src/infra/nmtp/logic/registry.ts` | `getTokenizerDriver` | function | `packages/core/test/infra/nmtp/registry.test.ts` |
| `packages/core/src/infra/nmtp/logic/registry.ts` | `registerTokenizerDriver` | function | `packages/core/test/infra/nmtp/registry.test.ts` |
| `packages/core/src/infra/random-uuid.ts` | `isRandomUuidV4` | function | `packages/core/test/agent/agent-runner.test.ts`<br>`packages/core/test/infra/random-uuid.test.ts` |
| `packages/core/src/infra/sksp/impl/composite-secret-store.ts` | `createCompositeSecretStore` | function | `packages/core/test/infra/sksp/composite.test.ts` |
| `packages/core/src/infra/sksp/impl/env-secret-store.ts` | `createEnvSecretStore` | function | `packages/core/test/infra/sksp/composite.test.ts` |
| `packages/core/src/infra/sksp/impl/env-secret-store.ts` | `EnvSecretStore` | class | `packages/core/test/infra/sksp/env-secret-store.test.ts` |
| `packages/core/src/infra/sksp/index.ts` | `clearSkspDrivers` | reexport | `apps/cli/test/sksp-platform.test.ts` |
| `packages/core/src/infra/sksp/logic/platform.ts` | `resolveSkspNameFromPlatform` | function | `packages/core/test/infra/sksp/platform.test.ts` |
| `packages/core/src/infra/sksp/logic/registry.ts` | `clearSkspDrivers` | function | `packages/core/test/infra/sksp/registry.test.ts` |
| `packages/core/src/infra/sksp/logic/registry.ts` | `registerSkspDriver` | function | `packages/core/test/infra/sksp/registry.test.ts` |
| `packages/core/src/infra/sksp/logic/registry.ts` | `resolveSkspDriver` | function | `packages/core/test/infra/sksp/registry.test.ts` |
| `packages/core/src/infra/sql-template/expression.ts` | `bindExpressionToContext` | function | `packages/core/test/infra/sql-template/expression.test.ts` |
| `packages/core/src/infra/sql-template/expression.ts` | `normalizeExpression` | function | `packages/core/test/infra/sql-template/expression.test.ts` |
| `packages/core/src/infra/sql-template/parser.ts` | `parseTemplateToAst` | function | `packages/core/test/infra/sql-template/parser.test.ts` |
| `packages/core/src/infra/tdbc/logic/normalize-bindings.ts` | `normalizeBindings` | function | `packages/core/test/infra/tdbc/normalize-bindings.test.ts` |
| `packages/core/src/infra/tdbc/logic/open.ts` | `parseUrl` | function | `packages/core/test/infra/tdbc/open.test.ts` |
| `packages/core/src/infra/tdbc/logic/registry.ts` | `clearDrivers` | function | `packages/core/test/infra/tdbc/open.test.ts` |
| `packages/core/src/infra/tdbc/logic/registry.ts` | `registerDriver` | function | `packages/core/test/infra/tdbc/open.test.ts` |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `clearForTests` | function | `packages/core/test/infra/tokenizer/encoding-registry.test.ts` |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `ENCODING_RETRY_TTL_MS` | const | `packages/core/test/infra/tokenizer/encoding-registry.test.ts` |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `setClockForTests` | function | `packages/core/test/infra/tokenizer/encoding-registry.test.ts` |
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | `setFactoryForTests` | function | `packages/core/test/infra/tokenizer/encoding-registry.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `clearTokenizerDrivers` | reexport | `packages/core/test/infra/tokenizer/count-prompt-llm-input.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `HeuristicTokenCounter` | reexport | `packages/core/test/infra/tokenizer/registry.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `pickLastPromptUsage` | reexport | `packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `PromptTokenResolveBailedError` | reexport | `packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `promptWholeCache` | reexport | `packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `resolveCurrentPromptTokens` | reexport | `packages/core/test/infra/tokenizer/chat-token-estimate-memo.test.ts`<br>`packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `serializeToolsForTokenCount` | reexport | `packages/core/test/infra/tokenizer/serialize-tools-for-token-count.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `sessionApiPromptTokenCache` | reexport | `packages/core/test/infra/tokenizer/chat-token-estimate-memo.test.ts`<br>`packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `splitTextIntoChunks` | reexport | `packages/core/test/infra/tokenizer/serialize-tools-for-token-count.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `tokenChunkCache` | reexport | `packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts` |
| `packages/core/src/infra/tokenizer/index.ts` | `TokenizerError` | reexport | `packages/core/test/infra/tokenizer/count-prompt-llm-input.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `clearChatTokenEstimateMemo` | function | `packages/core/test/agent/agent-runner-token-cache.test.ts`<br>`packages/core/test/infra/tokenizer/chat-token-estimate-memo.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chat-token-estimate-memo.ts` | `stampMessagesForEstimateMemo` | function | `packages/core/test/infra/tokenizer/chat-token-estimate-memo.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chunk-splitter.ts` | `MAX_CHUNK_CHARS` | const | `packages/core/test/infra/tokenizer/chunk-splitter.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chunk-splitter.ts` | `SENTENCE_END_CHARS` | const | `packages/core/test/infra/tokenizer/chunk-splitter.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chunk-splitter.ts` | `SOFT_BOUNDARY_CHARS` | const | `packages/core/test/infra/tokenizer/chunk-splitter.test.ts` |
| `packages/core/src/infra/tokenizer/logic/chunk-splitter.ts` | `splitTextIntoChunks` | function | `packages/core/test/infra/tokenizer/chunk-count-accuracy.test.ts`<br>`packages/core/test/infra/tokenizer/chunk-splitter.test.ts`<br>`packages/core/test/infra/tokenizer/token-chunk-cache.test.ts` |
| `packages/core/src/infra/tokenizer/logic/estimate-tokens-cjk-aware.ts` | `CJK_TOKENS_PER_CHAR` | const | `packages/core/test/infra/tokenizer/estimate-tokens-cjk-aware.test.ts` |
| `packages/core/src/infra/tokenizer/logic/incremental-token-counter.ts` | `IncrementalTokenCounterDeps` | interface | `packages/core/test/infra/tokenizer/incremental-token-counter.test.ts` |
| `packages/core/src/infra/tokenizer/logic/prompt-whole-cache.ts` | `PROMPT_WHOLE_CACHE_LRU_PER_SESSION` | const | `packages/core/test/infra/tokenizer/prompt-whole-cache.test.ts` |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts` | `parseSessionApiPromptTokenEntry` | function | `packages/core/test/infra/tokenizer/session-api-prompt-token-store.test.ts` |
| `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts` | `serializeSessionApiPromptTokenEntry` | function | `packages/core/test/compaction-conditions/run-compaction.test.ts`<br>`packages/core/test/compaction-conditions/token-ratio-trigger.test.ts`<br>`packages/core/test/infra/tokenizer/prompt-token-invalidation.test.ts`<br>`packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts`<br>`packages/core/test/infra/tokenizer/session-api-prompt-token-store.test.ts` |
| `packages/core/src/infra/tokenizer/logic/token-chunk-cache.ts` | `parseTokenChunkCachePayload` | function | `packages/core/test/infra/tokenizer/token-chunk-cache.test.ts` |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `extractSubagentSessionIdFromOutcome` | function | `packages/core/test/service/agent/extract-subagent-session-id.test.ts` |
| `packages/core/src/service/agent/impl/agent-runner.ts` | `wrapStreamForBus` | function | `packages/core/test/agent/agent-runner-stream-bus.test.ts` |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `assembleAgentsToolContext` | function | `packages/core/test/tool/agent-tool.test.ts` |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `assembleSearchToolContext` | function | `packages/core/test/tool/search-tool.test.ts` |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `assembleSkillsToolContext` | function | `packages/core/test/tool/skill-tool.test.ts` |
| `packages/core/src/service/chat/create-chat-services.ts` | `createUsageStatsService` | function | `packages/core/test/chat/usage-stats.service.test.ts` |
| `packages/core/src/service/chat/impl/user-vfs-turn.service.ts` | `UserVfsTurnServiceDeps` | interface | `packages/core/test/chat/user-vfs-turn.service.test.ts` |
| `packages/core/src/service/coordinated-write.ts` | `CoordinatedWriteRollbackError` | class | `packages/core/test/service/coordinated-write.test.ts` |
| `packages/core/src/service/coordinated-write.ts` | `runCoordinatedWrite` | function | `packages/core/test/service/coordinated-write.test.ts` |
| `packages/core/src/service/integrity-repair.ts` | `runIntegrityRepair` | function | `packages/core/test/service/integrity-repair.test.ts`<br>`packages/core/test/vfs/entry-sequence-repair.test.ts` |
| `packages/core/src/service/message-checkpoint/create-message-checkpoint-services.ts` | `MessageRollbackServiceOptions` | interface | `packages/core/test/message-checkpoint/rollback-probe.test.ts` |
| `packages/core/src/service/session-kkv/index.ts` | `createSessionKkvService` | reexport | `packages/core/test/infra/blob-binary-normalization.test.ts` |
| `packages/core/src/service/session-kkv/index.ts` | `SESSION_KKV_DOMAIN_FILE_CACHE` | reexport | `packages/core/test/infra/blob-binary-normalization.test.ts` |
| `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts` | `buildDefaultDirRule` | function | `packages/core/test/vfs/logic/ensure-import-dir-rules.test.ts` |
| `packages/core/src/service/workplace/impl/workplace-view-cache.ts` | `clearAllWorkplaceViewCache` | function | `packages/core/test/workplace/workplace-view-cache-smart-sig.test.ts`<br>`packages/core/test/workplace/workplace-view-cache.test.ts` |

## 四、公开面零外部消费（契约面，单列不判死）

> `packages/core/src/index.ts` 与 `packages/core/src/public/**` 是对外契约面（knip entry）。
> 下列符号在本仓内无任何 import 消费，但外部包/未来消费都可能用到，**不判死**，仅供 W3 导出面横切机位参考。

- public 面零外部消费：**547** 条
- public 面仅测试消费：**86** 条

| 文件 | 符号 | 导出类型 |
|---|---|---|
| `packages/core/src/index.ts` | `anyToolUseMutatesWorkspace` | reexport |
| `packages/core/src/index.ts` | `AstNode` | type |
| `packages/core/src/index.ts` | `bindExpressionToContext` | reexport |
| `packages/core/src/index.ts` | `BLOB_BINARY_KKV_MODULE` | reexport |
| `packages/core/src/index.ts` | `BlobBinaryStatus` | type |
| `packages/core/src/index.ts` | `BlobBinaryTableId` | type |
| `packages/core/src/index.ts` | `buildLease` | reexport |
| `packages/core/src/index.ts` | `buildToolResultBlock` | reexport |
| `packages/core/src/index.ts` | `BuildToolResultBlockMeta` | type |
| `packages/core/src/index.ts` | `canAcquireLock` | reexport |
| `packages/core/src/index.ts` | `CloudSyncCoordinatorDeps` | type |
| `packages/core/src/index.ts` | `CloudSyncErrorCode` | type |
| `packages/core/src/index.ts` | `CloudSyncLock` | type |
| `packages/core/src/index.ts` | `CloudSyncStatus` | type |
| `packages/core/src/index.ts` | `ConfigDecodeErrorCode` | type |
| `packages/core/src/index.ts` | `createVfsTools` | reexport |
| `packages/core/src/index.ts` | `DatabaseMaintenanceResult` | type |
| `packages/core/src/index.ts` | `DB_BACKUP_PROVIDER_TABLES` | reexport |
| `packages/core/src/index.ts` | `DbMaintenanceService` | type |
| `packages/core/src/index.ts` | `DbSyncPort` | type |
| `packages/core/src/index.ts` | `DEFAULT_BLOB_BINARY_SYNC_BUDGET_MS` | reexport |
| `packages/core/src/index.ts` | `DEFAULT_LEASE_SECONDS` | reexport |
| `packages/core/src/index.ts` | `EMPTY_CLOUD_SYNC_STATUS` | reexport |
| `packages/core/src/index.ts` | `EncodableSchema` | reexport |
| `packages/core/src/index.ts` | `ENGINE_IDS` | reexport |
| `packages/core/src/index.ts` | `evaluateTest` | reexport |
| `packages/core/src/index.ts` | `EvaluateTestOptions` | type |
| `packages/core/src/index.ts` | `executeTemplate` | reexport |
| `packages/core/src/index.ts` | `FILE_OPEN_TOOL_NAMES` | reexport |
| `packages/core/src/index.ts` | `FILE_TOOL_NAMES` | reexport |
| `packages/core/src/index.ts` | `FileToolName` | type |
| `packages/core/src/index.ts` | `getDriver` | reexport |
| `packages/core/src/index.ts` | `isEffectiveLock` | reexport |
| `packages/core/src/index.ts` | `isKkvError` | reexport |
| `packages/core/src/index.ts` | `isMutatingFileToolName` | reexport |
| `packages/core/src/index.ts` | `isMutatingFsCommand` | reexport |
| `packages/core/src/index.ts` | `isMutatingVfsToolName` | reexport |
| `packages/core/src/index.ts` | `KEY_CURRENT_AGENT_ID` | reexport |
| `packages/core/src/index.ts` | `KEY_CURRENT_MODEL_ID` | reexport |
| `packages/core/src/index.ts` | `KEY_CURRENT_PROJECT_ID` | reexport |
| `packages/core/src/index.ts` | `KEY_CURRENT_PROVIDER_ID` | reexport |
| `packages/core/src/index.ts` | `KEY_CURRENT_SESSION_ID` | reexport |
| `packages/core/src/index.ts` | `KEY_ENGINE_IDS` | reexport |
| `packages/core/src/index.ts` | `KkvErrorCode` | type |
| `packages/core/src/index.ts` | `listDrivers` | reexport |
| `packages/core/src/index.ts` | `MessageCompactionRunResult` | type |
| `packages/core/src/index.ts` | `MUTATING_FILE_TOOL_NAMES` | reexport |
| `packages/core/src/index.ts` | `MUTATING_VFS_TOOL_NAMES` | reexport |
| `packages/core/src/index.ts` | `normalizeExpression` | reexport |
| `packages/core/src/index.ts` | `ParallelToolOutcome` | type |
| `packages/core/src/index.ts` | `ParsedTdbcUrl` | type |
| `packages/core/src/index.ts` | `ParseOptions` | type |
| `packages/core/src/index.ts` | `parseTemplateToAst` | reexport |
| `packages/core/src/index.ts` | `parseUrl` | reexport |
| `packages/core/src/index.ts` | `PREFERENCES_MODULE` | reexport |
| `packages/core/src/index.ts` | `PreferencesErrorCode` | type |
| `packages/core/src/index.ts` | `ProviderBackupTableName` | type |
| `packages/core/src/index.ts` | `ProviderTableSnapshotErrorCode` | type |
| `packages/core/src/index.ts` | `PullOptions` | type |
| `packages/core/src/index.ts` | `PullResult` | type |
| `packages/core/src/index.ts` | `PushOptions` | type |
| `packages/core/src/index.ts` | `PushResult` | type |
| `packages/core/src/index.ts` | `queryTemplate` | reexport |
| `packages/core/src/index.ts` | `readSearchConfig` | reexport |
| `packages/core/src/index.ts` | `registerVfsTools` | reexport |
| `packages/core/src/index.ts` | `renewLease` | reexport |
| `packages/core/src/index.ts` | `ResolvedEngineConfig` | type |
| `packages/core/src/index.ts` | `resolveDriver` | reexport |
| `packages/core/src/index.ts` | `resolveEngineChain` | reexport |
| `packages/core/src/index.ts` | `RunBlobBinaryNormalizationOptions` | type |
| `packages/core/src/index.ts` | `runDeferredFileCacheGc` | reexport |
| `packages/core/src/index.ts` | `RunMessageContentCompactionOptions` | type |
| `packages/core/src/index.ts` | `SEARCH_KKV_MODULE` | reexport |
| `packages/core/src/index.ts` | `searchApiKeyRef` | reexport |
| `packages/core/src/index.ts` | `SearchConfigDeps` | type |
| `packages/core/src/index.ts` | `SearchEngineStatus` | type |
| `packages/core/src/index.ts` | `SearchOversizeOutput` | type |
| `packages/core/src/index.ts` | `SearchRecency` | type |
| `packages/core/src/index.ts` | `SearchResponse` | type |
| `packages/core/src/index.ts` | `SearchResult` | type |
| `packages/core/src/index.ts` | `SearchToolOptions` | type |
| `packages/core/src/index.ts` | `snapshotKey` | reexport |
| `packages/core/src/index.ts` | `SqlParseResult` | type |
| `packages/core/src/index.ts` | `SqlTemplateError` | reexport |
| `packages/core/src/index.ts` | `SqlTemplateErrorCode` | type |
| `packages/core/src/index.ts` | `StorageStats` | type |
| `packages/core/src/index.ts` | `TdbcErrorCode` | type |
| `packages/core/src/index.ts` | `Tool` | type |
| `packages/core/src/index.ts` | `TOOL_OUTPUT_MAX_BYTES` | reexport |
| `packages/core/src/index.ts` | `TOOL_OUTPUT_MAX_LINE_LENGTH` | reexport |
| `packages/core/src/index.ts` | `TOOL_OUTPUT_MAX_LINES` | reexport |
| `packages/core/src/index.ts` | `TOOL_OUTPUT_MAX_MATCHES` | reexport |
| `packages/core/src/index.ts` | `ToolCall` | type |
| `packages/core/src/index.ts` | `ToolErrorCode` | type |
| `packages/core/src/index.ts` | `ToolResourceQuota` | type |
| `packages/core/src/index.ts` | `toolUseMutatesWorkspace` | reexport |
| `packages/core/src/index.ts` | `validateProviderTableSnapshot` | reexport |
| `packages/core/src/index.ts` | `VfsToolContext` | type |
| `packages/core/src/index.ts` | `WORKSPACE_STATE_MODULE` | reexport |
| `packages/core/src/public/agent.ts` | `AgentConfigErrorCode` | type |
| `packages/core/src/public/agent.ts` | `agentDefinitionDocumentSchema` | reexport |
| `packages/core/src/public/agent.ts` | `AgentErrorCode` | type |
| `packages/core/src/public/agent.ts` | `AgentRunner` | type |
| `packages/core/src/public/agent.ts` | `AgentRunOptions` | type |
| `packages/core/src/public/agent.ts` | `AgentRunRuntimePort` | type |
| `packages/core/src/public/agent.ts` | `AgentSession` | type |
| `packages/core/src/public/agent.ts` | `AgentStreamPartial` | type |
| `packages/core/src/public/agent.ts` | `AgentToolPolicy` | type |
| `packages/core/src/public/agent.ts` | `assembleAgentRunnerDeps` | reexport |
| `packages/core/src/public/agent.ts` | `AssembleAgentRunnerDepsInput` | reexport |
| `packages/core/src/public/agent.ts` | `assertNoCrossRoundDoomLoop` | reexport |
| `packages/core/src/public/agent.ts` | `assertNoDoomLoopInBlocks` | reexport |
| `packages/core/src/public/agent.ts` | `CROSS_ROUND_WINDOW` | reexport |
| `packages/core/src/public/agent.ts` | `DEFAULT_AGENT_MAX_STEPS` | reexport |
| `packages/core/src/public/agent.ts` | `DOOM_LOOP_THRESHOLD` | reexport |
| `packages/core/src/public/agent.ts` | `ModelRoundSummary` | type |
| `packages/core/src/public/agent.ts` | `PENDING_RUN_ID` | reexport |
| `packages/core/src/public/agent.ts` | `ResolveAgentForProjectRuntimePort` | type |
| `packages/core/src/public/agent.ts` | `ResolveSavedModelIdInput` | reexport |
| `packages/core/src/public/agent.ts` | `resolveSummarySavedModelId` | reexport |
| `packages/core/src/public/agent.ts` | `ResolveSummarySavedModelIdInput` | reexport |
| `packages/core/src/public/agent.ts` | `RunAgentTurnAfterResolveContext` | type |
| `packages/core/src/public/agent.ts` | `RunAgentTurnOptions` | type |
| `packages/core/src/public/agent.ts` | `shouldAcceptRunEvent` | reexport |
| `packages/core/src/public/agent.ts` | `shouldApplyTranscriptReload` | reexport |
| `packages/core/src/public/agent.ts` | `ShouldApplyTranscriptReloadOptions` | type |
| `packages/core/src/public/agent.ts` | `shouldIgnoreStaleRunStarted` | reexport |
| `packages/core/src/public/agent.ts` | `shouldReloadTranscriptOnRunEvent` | reexport |
| `packages/core/src/public/chat.ts` | `ANNOTATE_ANCHOR_CLASS` | reexport |
| `packages/core/src/public/chat.ts` | `AnnotateDrafts` | type |
| `packages/core/src/public/chat.ts` | `annotateDraftSchema` | reexport |
| `packages/core/src/public/chat.ts` | `annotateDraftsSchema` | reexport |
| `packages/core/src/public/chat.ts` | `annotateOccurrenceOrdinal` | reexport |
| `packages/core/src/public/chat.ts` | `AnnotateQuoteContext` | type |
| `packages/core/src/public/chat.ts` | `annotateRangeMatchesOriginalText` | reexport |
| `packages/core/src/public/chat.ts` | `AnnotateSoftOffsetRange` | type |
| `packages/core/src/public/chat.ts` | `AnnotateSoftRangeFields` | type |
| `packages/core/src/public/chat.ts` | `AnnotateSoftSourceRange` | type |
| `packages/core/src/public/chat.ts` | `AnnotateSourceMatch` | type |
| `packages/core/src/public/chat.ts` | `AnnotateSourceMatchStrategy` | type |
| `packages/core/src/public/chat.ts` | `applySoftRangeLinePadding` | reexport |
| `packages/core/src/public/chat.ts` | `AtPathRef` | type |
| `packages/core/src/public/chat.ts` | `atPathTokensFromPickerSelection` | reexport |
| `packages/core/src/public/chat.ts` | `ATTACH_DIR_TREE_MAX_UTF8_BYTES` | reexport |
| `packages/core/src/public/chat.ts` | `attachmentStorageName` | reexport |
| `packages/core/src/public/chat.ts` | `buildAlreadyReferencedActionXml` | reexport |
| `packages/core/src/public/chat.ts` | `BuildAnnotatedSourceInput` | type |
| `packages/core/src/public/chat.ts` | `BuildAnnotatedSourceMode` | type |
| `packages/core/src/public/chat.ts` | `BuildAnnotatedSourceResult` | type |
| `packages/core/src/public/chat.ts` | `buildAttachmentActionXml` | reexport |
| `packages/core/src/public/chat.ts` | `buildDirTreeActionXml` | reexport |
| `packages/core/src/public/chat.ts` | `buildFileAnnotateAttachmentFromDraft` | reexport |
| `packages/core/src/public/chat.ts` | `buildFileRefActionXml` | reexport |
| `packages/core/src/public/chat.ts` | `buildFlatTextIndex` | reexport |
| `packages/core/src/public/chat.ts` | `buildUserVfsTurnView` | reexport |
| `packages/core/src/public/chat.ts` | `ChatErrorCode` | type |
| `packages/core/src/public/chat.ts` | `ChatServiceBundle` | type |
| `packages/core/src/public/chat.ts` | `ChatServicesSessionDeps` | type |
| `packages/core/src/public/chat.ts` | `ComposerChipAttachment` | type |
| `packages/core/src/public/chat.ts` | `ComposerDraft` | type |
| `packages/core/src/public/chat.ts` | `ComposerDraftAttachment` | type |
| `packages/core/src/public/chat.ts` | `composerDraftAttachmentSchema` | reexport |
| `packages/core/src/public/chat.ts` | `composerDraftSchema` | reexport |
| `packages/core/src/public/chat.ts` | `ComposerSendIntent` | type |
| `packages/core/src/public/chat.ts` | `ComposerSendIntentAttachment` | type |
| `packages/core/src/public/chat.ts` | `ComposerSendIntentInput` | type |
| `packages/core/src/public/chat.ts` | `ComposerTrigger` | type |
| `packages/core/src/public/chat.ts` | `computeHideRangeFromSelection` | reexport |
| `packages/core/src/public/chat.ts` | `computeSetFloorRanges` | reexport |
| `packages/core/src/public/chat.ts` | `computeShowRangeFromSelection` | reexport |
| `packages/core/src/public/chat.ts` | `computeStreamTailGenerating` | reexport |
| `packages/core/src/public/chat.ts` | `computeTailBatchAffectedIds` | reexport |
| `packages/core/src/public/chat.ts` | `computeTailBatchRangeFromSelection` | reexport |
| `packages/core/src/public/chat.ts` | `computeVisibilityBatchAffectedIds` | reexport |
| `packages/core/src/public/chat.ts` | `countAnnotateOccurrencesInSource` | reexport |
| `packages/core/src/public/chat.ts` | `countScannedAtPathAttachments` | reexport |
| `packages/core/src/public/chat.ts` | `createPromptPathSeenSet` | reexport |
| `packages/core/src/public/chat.ts` | `createUsageStatsService` | reexport |
| `packages/core/src/public/chat.ts` | `createUserVfsTurnService` | reexport |
| `packages/core/src/public/chat.ts` | `DEFAULT_PROJECT_AGENT_CONFIG` | reexport |
| `packages/core/src/public/chat.ts` | `DEFAULT_STREAM_TAIL_IDLE_MS` | reexport |
| `packages/core/src/public/chat.ts` | `deriveDirPathsFromFileTree` | reexport |
| `packages/core/src/public/chat.ts` | `deriveSoftRangeFieldsFromOffsets` | reexport |
| `packages/core/src/public/chat.ts` | `deriveToolUsesFromVfsActions` | reexport |
| `packages/core/src/public/chat.ts` | `elideChatLinkPath` | reexport |
| `packages/core/src/public/chat.ts` | `EMPTY_COMPOSER_DRAFT` | reexport |
| `packages/core/src/public/chat.ts` | `emptyWorkspaceFlushSnapshot` | reexport |
| `packages/core/src/public/chat.ts` | `escapeAnnotateSourceText` | reexport |
| `packages/core/src/public/chat.ts` | `estimateSoftRangeFromOriginalText` | reexport |
| `packages/core/src/public/chat.ts` | `estimateSoftRangeFromPlainOffsets` | reexport |
| `packages/core/src/public/chat.ts` | `expandSoftRangeOnce` | reexport |
| `packages/core/src/public/chat.ts` | `filterAtPathTypeaheadCandidates` | reexport |
| `packages/core/src/public/chat.ts` | `findActiveAtQuery` | reexport |
| `packages/core/src/public/chat.ts` | `findAllOccurrences` | reexport |
| `packages/core/src/public/chat.ts` | `findAnnotateOccurrenceInSource` | reexport |
| `packages/core/src/public/chat.ts` | `findMarkdownCodeRanges` | reexport |
| `packages/core/src/public/chat.ts` | `FlatSegmentLocalRange` | type |
| `packages/core/src/public/chat.ts` | `FlatTextIndex` | type |
| `packages/core/src/public/chat.ts` | `FlatTextSegmentSpan` | type |
| `packages/core/src/public/chat.ts` | `formatComposerAtPathToken` | reexport |
| `packages/core/src/public/chat.ts` | `formatStatusChipLabel` | reexport |
| `packages/core/src/public/chat.ts` | `formatUserVfsTurnPreviewBody` | reexport |
| `packages/core/src/public/chat.ts` | `groupAnnotateIdsByOriginalText` | reexport |
| `packages/core/src/public/chat.ts` | `hasToolResult` | reexport |
| `packages/core/src/public/chat.ts` | `hasValidAnnotateOffsetRange` | reexport |
| `packages/core/src/public/chat.ts` | `hasValidAnnotateSoftRange` | reexport |
| `packages/core/src/public/chat.ts` | `ImageBlock` | type |
| `packages/core/src/public/chat.ts` | `ImageSource` | type |
| `packages/core/src/public/chat.ts` | `isComposerDraftAttachment` | reexport |
| `packages/core/src/public/chat.ts` | `isComposerStatusAttachment` | reexport |
| `packages/core/src/public/chat.ts` | `isMessageAnnotatePath` | reexport |
| `packages/core/src/public/chat.ts` | `isPromptDirTokenPath` | reexport |
| `packages/core/src/public/chat.ts` | `isSetFloorAnchorRole` | reexport |
| `packages/core/src/public/chat.ts` | `isTailBatchRowSelectable` | reexport |
| `packages/core/src/public/chat.ts` | `isTranscriptRowSelectable` | reexport |
| `packages/core/src/public/chat.ts` | `listVisibleSorted` | reexport |
| `packages/core/src/public/chat.ts` | `locateAnnotateOffsetRangeByQuoteContext` | reexport |
| `packages/core/src/public/chat.ts` | `logicalParentDir` | reexport |
| `packages/core/src/public/chat.ts` | `mapFlatRangeToSegments` | reexport |
| `packages/core/src/public/chat.ts` | `matchUserVfsTurnAt` | reexport |
| `packages/core/src/public/chat.ts` | `mergeAttachmentsByPath` | reexport |
| `packages/core/src/public/chat.ts` | `mergeAttachmentsWithScannedAtPaths` | reexport |
| `packages/core/src/public/chat.ts` | `mergeAttachmentsWithScannedSkills` | reexport |
| `packages/core/src/public/chat.ts` | `MergedPendingVfsTurn` | type |
| `packages/core/src/public/chat.ts` | `mergePendingVfsTurns` | reexport |
| `packages/core/src/public/chat.ts` | `MESSAGE_ANNOTATE_PATH_MARKER` | reexport |
| `packages/core/src/public/chat.ts` | `MessageAttachmentAction` | type |
| `packages/core/src/public/chat.ts` | `messageAttachmentActionSchema` | reexport |
| `packages/core/src/public/chat.ts` | `messageAttachmentSchema` | reexport |
| `packages/core/src/public/chat.ts` | `messageAttachmentsSchema` | reexport |
| `packages/core/src/public/chat.ts` | `MessageMetadata` | type |
| `packages/core/src/public/chat.ts` | `MessageMetadataKind` | type |
| `packages/core/src/public/chat.ts` | `MessageSearchQuery` | type |
| `packages/core/src/public/chat.ts` | `NO_PATH_ATTACHMENT_NAME` | reexport |
| `packages/core/src/public/chat.ts` | `normalizeAnnotateNeedle` | reexport |
| `packages/core/src/public/chat.ts` | `normalizeAnnotateNeedleStripNewlines` | reexport |
| `packages/core/src/public/chat.ts` | `normalizeAnnotateSegmentText` | reexport |
| `packages/core/src/public/chat.ts` | `normalizePromptSeenPath` | reexport |
| `packages/core/src/public/chat.ts` | `normalizePromptStorePath` | reexport |
| `packages/core/src/public/chat.ts` | `offsetToSourceLineCol` | reexport |
| `packages/core/src/public/chat.ts` | `parseAllUserVfsActionsFromText` | reexport |
| `packages/core/src/public/chat.ts` | `parseAnnotateIdsAttr` | reexport |
| `packages/core/src/public/chat.ts` | `parseAttachmentsJson` | reexport |
| `packages/core/src/public/chat.ts` | `ParsedUserVfsAction` | type |
| `packages/core/src/public/chat.ts` | `ParsedUserVfsEditHunk` | type |
| `packages/core/src/public/chat.ts` | `PrepareUserMessagesForPromptRuntime` | type |
| `packages/core/src/public/chat.ts` | `ProjectAgentConfig` | type |
| `packages/core/src/public/chat.ts` | `ProjectAgentConfigPatch` | type |
| `packages/core/src/public/chat.ts` | `ProjectAgentMode` | type |
| `packages/core/src/public/chat.ts` | `PROMPT_FILE_SEEN_SHORT_TIP` | reexport |
| `packages/core/src/public/chat.ts` | `RedactedThinkingBlock` | type |
| `packages/core/src/public/chat.ts` | `removeChatAnnotateDraftsByPath` | reexport |
| `packages/core/src/public/chat.ts` | `renameChipZh` | reexport |
| `packages/core/src/public/chat.ts` | `renderDirAttachTree` | reexport |
| `packages/core/src/public/chat.ts` | `RenderDirAttachTreeDeps` | type |
| `packages/core/src/public/chat.ts` | `replaceActiveAtWithToken` | reexport |
| `packages/core/src/public/chat.ts` | `resolveRenameOrMoveAction` | reexport |
| `packages/core/src/public/chat.ts` | `RollbackConfirmKind` | type |
| `packages/core/src/public/chat.ts` | `RollbackMode` | type |
| `packages/core/src/public/chat.ts` | `scanSkillAttachments` | reexport |
| `packages/core/src/public/chat.ts` | `selectAnnotateOccurrenceStarts` | reexport |
| `packages/core/src/public/chat.ts` | `selectTailBatchEligibleIdsFromAnchor` | reexport |
| `packages/core/src/public/chat.ts` | `selectVisibilityBatchEligibleIdsFromAnchor` | reexport |
| `packages/core/src/public/chat.ts` | `serializeAttachmentsJson` | reexport |
| `packages/core/src/public/chat.ts` | `SessionUsageLastRequest` | type |
| `packages/core/src/public/chat.ts` | `SetMessageFloorResult` | type |
| `packages/core/src/public/chat.ts` | `skillSeenKey` | reexport |
| `packages/core/src/public/chat.ts` | `sliceSourceBySoftRange` | reexport |
| `packages/core/src/public/chat.ts` | `sortAnnotateTextsLongestFirst` | reexport |
| `packages/core/src/public/chat.ts` | `splitMarkdownUnderlineRuns` | reexport |
| `packages/core/src/public/chat.ts` | `splitSourceLines` | reexport |
| `packages/core/src/public/chat.ts` | `STATUS_CHIP_ZH` | reexport |
| `packages/core/src/public/chat.ts` | `tailBatchDeleteAfterSeq` | reexport |
| `packages/core/src/public/chat.ts` | `TailBatchMode` | type |
| `packages/core/src/public/chat.ts` | `TextBlock` | type |
| `packages/core/src/public/chat.ts` | `ThinkingBlock` | type |
| `packages/core/src/public/chat.ts` | `transcriptSelectableRole` | reexport |
| `packages/core/src/public/chat.ts` | `TranscriptSelectableRole` | type |
| `packages/core/src/public/chat.ts` | `tryNormalizePromptSeenPath` | reexport |
| `packages/core/src/public/chat.ts` | `UsageStatsRequestPage` | type |
| `packages/core/src/public/chat.ts` | `UsageStatsRequestPageQuery` | type |
| `packages/core/src/public/chat.ts` | `USER_VFS_TURN_SPAN` | reexport |
| `packages/core/src/public/chat.ts` | `UserVfsPendingEntry` | type |
| `packages/core/src/public/chat.ts` | `userVfsPendingEntrySchema` | reexport |
| `packages/core/src/public/chat.ts` | `UserVfsPendingQueue` | type |
| `packages/core/src/public/chat.ts` | `userVfsPendingQueueSchema` | reexport |
| `packages/core/src/public/chat.ts` | `UserVfsPendingTool` | type |
| `packages/core/src/public/chat.ts` | `userVfsPendingToolSchema` | reexport |
| `packages/core/src/public/chat.ts` | `UserVfsTurnExecuteResult` | type |
| `packages/core/src/public/chat.ts` | `UserVfsTurnServiceBundle` | type |
| `packages/core/src/public/chat.ts` | `UserVfsTurnToolSpec` | type |
| `packages/core/src/public/chat.ts` | `UserVfsTurnView` | type |
| `packages/core/src/public/chat.ts` | `VisibilityBatchMessage` | type |
| `packages/core/src/public/chat.ts` | `visibleFloorByMessageId` | reexport |
| `packages/core/src/public/chat.ts` | `WorkspaceFlushSnapshot` | type |
| `packages/core/src/public/chat.ts` | `wrapUserMessageForLlm` | reexport |
| `packages/core/src/public/compaction.ts` | `CompactionConditionsErrorCode` | type |
| `packages/core/src/public/compaction.ts` | `compactionConditionsInvalidSchema` | reexport |
| `packages/core/src/public/compaction.ts` | `depthByMessageId` | reexport |
| `packages/core/src/public/compaction.ts` | `DepthSlice` | type |
| `packages/core/src/public/compaction.ts` | `HideMessageSeqRange` | type |
| `packages/core/src/public/compaction.ts` | `listVisibleForDepth` | reexport |
| `packages/core/src/public/compaction.ts` | `matchDepth` | reexport |
| `packages/core/src/public/compaction.ts` | `messageIdsInSlice` | reexport |
| `packages/core/src/public/compaction.ts` | `resolveHideMessageRange` | reexport |
| `packages/core/src/public/compaction.ts` | `RunCompactionParams` | reexport |
| `packages/core/src/public/compaction.ts` | `RunCompactionResult` | reexport |
| `packages/core/src/public/compaction.ts` | `validateDepthSlice` | reexport |
| `packages/core/src/public/events.ts` | `AgentStepCommittedPhase` | type |
| `packages/core/src/public/events.ts` | `EventBus` | type |
| `packages/core/src/public/events.ts` | `NovelMasterEventType` | type |
| `packages/core/src/public/feature-flags.ts` | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN` | reexport |
| `packages/core/src/public/format.ts` | `DEFAULT_COMMIT_STEP_CHARS` | reexport |
| `packages/core/src/public/format.ts` | `DEFAULT_LOOKBACK_CHARS` | reexport |
| `packages/core/src/public/format.ts` | `DEFAULT_TAIL_CHARS` | reexport |
| `packages/core/src/public/format.ts` | `formatStreamElapsed` | reexport |
| `packages/core/src/public/format.ts` | `IncrementalTokenCounterDeps` | reexport |
| `packages/core/src/public/format.ts` | `SLIDING_TOKEN_RATE_WINDOW_MS` | reexport |
| `packages/core/src/public/format.ts` | `slidingTokenRate` | reexport |
| `packages/core/src/public/format.ts` | `StreamFinalRateSnapshot` | reexport |
| `packages/core/src/public/format.ts` | `StreamMetricsLineInput` | reexport |
| `packages/core/src/public/format.ts` | `TokenRateSample` | reexport |
| `packages/core/src/public/kkv.ts` | `isKkvError` | reexport |
| `packages/core/src/public/kkv.ts` | `KkvErrorCode` | type |
| `packages/core/src/public/prompt.ts` | `expandDynamicMacros` | reexport |
| `packages/core/src/public/prompt.ts` | `layoutHasWorkplace` | reexport |
| `packages/core/src/public/prompt.ts` | `LlmExportZone` | type |
| `packages/core/src/public/prompt.ts` | `LlmExportZones` | type |
| `packages/core/src/public/prompt.ts` | `normalizeForLlmExport` | reexport |
| `packages/core/src/public/prompt.ts` | `PersistWorktreePromptBlock` | type |
| `packages/core/src/public/prompt.ts` | `PromptAssemblyOptions` | type |
| `packages/core/src/public/prompt.ts` | `PromptAssemblySegment` | type |
| `packages/core/src/public/prompt.ts` | `PromptErrorCode` | type |
| `packages/core/src/public/prompt.ts` | `ResolvedPreviewThinkingContext` | type |
| `packages/core/src/public/prompt.ts` | `ResolvePreviewThinkingContextInput` | type |
| `packages/core/src/public/prompt.ts` | `resolveWorkplaceFromWire` | reexport |
| `packages/core/src/public/prompt.ts` | `shouldIncludeDynamicBlock` | reexport |
| `packages/core/src/public/prompt.ts` | `ThinkingContextOptions` | type |
| `packages/core/src/public/prompt.ts` | `validateAgentPromptLayout` | reexport |
| `packages/core/src/public/prompt.ts` | `validateDynamicMacros` | reexport |
| `packages/core/src/public/provider.ts` | `AdvanceGenerationOptions` | reexport |
| `packages/core/src/public/provider.ts` | `ANTHROPIC_SAMPLING_DEFAULTS` | reexport |
| `packages/core/src/public/provider.ts` | `AnthropicSamplingParams` | type |
| `packages/core/src/public/provider.ts` | `AnthropicThinkingParams` | type |
| `packages/core/src/public/provider.ts` | `applySavedModelSettingsPatch` | reexport |
| `packages/core/src/public/provider.ts` | `ChatTokenCountKind` | reexport |
| `packages/core/src/public/provider.ts` | `ChatTokenEncoder` | reexport |
| `packages/core/src/public/provider.ts` | `ChatTokenMessage` | reexport |
| `packages/core/src/public/provider.ts` | `CHUNK_CACHE_MAX_TOTAL_ENTRIES` | reexport |
| `packages/core/src/public/provider.ts` | `clearTokenizerDrivers` | reexport |
| `packages/core/src/public/provider.ts` | `CounterScopeInput` | reexport |
| `packages/core/src/public/provider.ts` | `CountOpenAiStyleMessageOptions` | reexport |
| `packages/core/src/public/provider.ts` | `countTokens` | reexport |
| `packages/core/src/public/provider.ts` | `CountTokensOptions` | reexport |
| `packages/core/src/public/provider.ts` | `CreateDefaultTokenCounterRegistryDeps` | reexport |
| `packages/core/src/public/provider.ts` | `createModelRetryPolicyService` | reexport |
| `packages/core/src/public/provider.ts` | `CreateProviderInput` | type |
| `packages/core/src/public/provider.ts` | `EditProviderPatch` | type |
| `packages/core/src/public/provider.ts` | `EncodingFactory` | reexport |
| `packages/core/src/public/provider.ts` | `EncodingHandle` | reexport |
| `packages/core/src/public/provider.ts` | `formatApplicationModelId` | reexport |
| `packages/core/src/public/provider.ts` | `GEMINI_SAMPLING_DEFAULTS` | reexport |
| `packages/core/src/public/provider.ts` | `GeminiSamplingParams` | type |
| `packages/core/src/public/provider.ts` | `GeminiThinkingConfig` | type |
| `packages/core/src/public/provider.ts` | `GeminiThinkingParams` | type |
| `packages/core/src/public/provider.ts` | `getTokenizerDriver` | reexport |
| `packages/core/src/public/provider.ts` | `inferLlmProtocolFromApplicationModelId` | reexport |
| `packages/core/src/public/provider.ts` | `inferLlmProtocolFromSavedModelId` | reexport |
| `packages/core/src/public/provider.ts` | `isLlmFetchDebugEnabled` | reexport |
| `packages/core/src/public/provider.ts` | `LLM_STREAM_TIMEOUT_ERROR_NAME` | reexport |
| `packages/core/src/public/provider.ts` | `LlmProvider` | type |
| `packages/core/src/public/provider.ts` | `LlmStreamTimeoutPhase` | reexport |
| `packages/core/src/public/provider.ts` | `LlmTokenUsage` | type |
| `packages/core/src/public/provider.ts` | `LlmToolDefinition` | type |
| `packages/core/src/public/provider.ts` | `MAX_CHUNK_CHARS` | reexport |
| `packages/core/src/public/provider.ts` | `ModelRetryPolicy` | type |
| `packages/core/src/public/provider.ts` | `ModelRetryPolicyService` | type |
| `packages/core/src/public/provider.ts` | `ModelThinkingParams` | type |
| `packages/core/src/public/provider.ts` | `normalizeVendorModelId` | reexport |
| `packages/core/src/public/provider.ts` | `OpenAiSamplingParams` | type |
| `packages/core/src/public/provider.ts` | `OpenAiThinkingParams` | type |
| `packages/core/src/public/provider.ts` | `parseApplicationModelId` | reexport |
| `packages/core/src/public/provider.ts` | `parseTokenChunkCachePayload` | reexport |
| `packages/core/src/public/provider.ts` | `parseTokenCounterModePref` | reexport |
| `packages/core/src/public/provider.ts` | `pickLastPromptUsage` | reexport |
| `packages/core/src/public/provider.ts` | `PROMPT_WHOLE_CACHE_LRU_PER_SESSION` | reexport |
| `packages/core/src/public/provider.ts` | `PromptTokenSource` | reexport |
| `packages/core/src/public/provider.ts` | `PromptWholeCacheEntry` | reexport |
| `packages/core/src/public/provider.ts` | `providerApiKeyRef` | reexport |
| `packages/core/src/public/provider.ts` | `ProviderErrorCode` | type |
| `packages/core/src/public/provider.ts` | `ResolvedPromptTokens` | reexport |
| `packages/core/src/public/provider.ts` | `resolveEffectiveMaxTokens` | reexport |
| `packages/core/src/public/provider.ts` | `resolveThinkingParamsForLevel` | reexport |
| `packages/core/src/public/provider.ts` | `resolveTokenizerDriver` | reexport |
| `packages/core/src/public/provider.ts` | `samplingProtocol` | reexport |
| `packages/core/src/public/provider.ts` | `SavedModelGenerationSettings` | type |
| `packages/core/src/public/provider.ts` | `SavedModelInternalSettings` | type |
| `packages/core/src/public/provider.ts` | `SavedModelSamplingSettings` | type |
| `packages/core/src/public/provider.ts` | `SavedModelSettings` | type |
| `packages/core/src/public/provider.ts` | `SavedModelView` | reexport |
| `packages/core/src/public/provider.ts` | `seedContextWindowTokens` | reexport |
| `packages/core/src/public/provider.ts` | `SessionApiPromptTokenCacheEntry` | reexport |
| `packages/core/src/public/provider.ts` | `SSE_WHOLE_CALL_TIMEOUT_MS` | reexport |
| `packages/core/src/public/provider.ts` | `SseTransport` | type |
| `packages/core/src/public/provider.ts` | `STREAM_IDLE_TIMEOUT_MS` | reexport |
| `packages/core/src/public/provider.ts` | `THINKING_LEVEL_OPTIONS` | reexport |
| `packages/core/src/public/provider.ts` | `thinkingLevelToModelThinkingParams` | reexport |
| `packages/core/src/public/provider.ts` | `thinkingProtocol` | reexport |
| `packages/core/src/public/provider.ts` | `TOKEN_COUNTER_MODE_OPTIONS` | reexport |
| `packages/core/src/public/provider.ts` | `TOKEN_COUNTER_MODE_PREF_KEY` | reexport |
| `packages/core/src/public/provider.ts` | `TokenChunkCacheItem` | reexport |
| `packages/core/src/public/provider.ts` | `TokenEncoder` | reexport |
| `packages/core/src/public/provider.ts` | `TokenizerDriver` | reexport |
| `packages/core/src/public/provider.ts` | `TokenizerError` | reexport |
| `packages/core/src/public/provider.ts` | `TokenizerErrorCode` | reexport |
| `packages/core/src/public/provider.ts` | `TokenSourceBadge` | reexport |
| `packages/core/src/public/provider.ts` | `toSavedModelView` | reexport |
| `packages/core/src/public/provider.ts` | `zodToJsonSchema` | reexport |
| `packages/core/src/public/session-fs.ts` | `isRollbackConflictError` | reexport |
| `packages/core/src/public/session-fs.ts` | `RollbackOptions` | type |
| `packages/core/src/public/session-fs.ts` | `SessionFsErrorCode` | type |
| `packages/core/src/public/session-fs.ts` | `sessionFsRollbackConflict` | reexport |
| `packages/core/src/public/session-fs.ts` | `sessionFsRollbackMessageSessionMismatch` | reexport |
| `packages/core/src/public/session-fs.ts` | `sessionFsRollbackNoCheckpoint` | reexport |
| `packages/core/src/public/session-fs.ts` | `sessionFsRollbackRevisionBackfillRequired` | reexport |
| `packages/core/src/public/session-kkv.ts` | `fileCacheKey` | reexport |
| `packages/core/src/public/session-kkv.ts` | `PROMPT_TOKENS_LAST_USAGE_KEY` | reexport |
| `packages/core/src/public/session-kkv.ts` | `RULE_SNAPSHOT_CANON_KEY` | reexport |
| `packages/core/src/public/session-kkv.ts` | `SESSION_KKV_COMPOSER_STATUS_DOMAINS` | reexport |
| `packages/core/src/public/session-kkv.ts` | `SESSION_KKV_DOMAIN_PROMPT_TOKENS` | reexport |
| `packages/core/src/public/session-kkv.ts` | `SESSION_KKV_DOMAIN_USER_VFS_PENDING` | reexport |
| `packages/core/src/public/session-kkv.ts` | `USER_VFS_PENDING_QUEUE_KEY` | reexport |
| `packages/core/src/public/session-kkv.ts` | `WorkplaceDisplayStatus` | reexport |
| `packages/core/src/public/session-run-state.ts` | `SessionRunStateService` | type |
| `packages/core/src/public/session-run-state.ts` | `SessionRunStateTokenSource` | type |
| `packages/core/src/public/skills.ts` | `computeEffectiveSkills` | reexport |
| `packages/core/src/public/skills.ts` | `EffectiveSkillsInput` | type |
| `packages/core/src/public/skills.ts` | `isValidSkillName` | reexport |
| `packages/core/src/public/skills.ts` | `ParsedSkillFrontMatter` | type |
| `packages/core/src/public/skills.ts` | `parseSkillFrontMatter` | reexport |
| `packages/core/src/public/skills.ts` | `SKILL_NAME_PATTERN` | reexport |
| `packages/core/src/public/skills.ts` | `SKILL_NAME_PATTERN_SOURCE` | reexport |
| `packages/core/src/public/skills.ts` | `SKILL_RESERVED_NAME` | reexport |
| `packages/core/src/public/skills.ts` | `SkillEditMatch` | type |
| `packages/core/src/public/skills.ts` | `SkillErrorCode` | type |
| `packages/core/src/public/skills.ts` | `SkillFileContent` | type |
| `packages/core/src/public/skills.ts` | `SkillFrontMatter` | type |
| `packages/core/src/public/skills.ts` | `skillFrontMatterSchema` | reexport |
| `packages/core/src/public/skills.ts` | `SkillFrontMatterValues` | type |
| `packages/core/src/public/skills.ts` | `SkillRef` | type |
| `packages/core/src/public/skills.ts` | `SkillSummary` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `BUILTIN_SMART_SORT_RULE_ID_PREFIX` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `compileSmartSortRule` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `CreateSmartSortRuleInput` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `createSmartSortRuleSchema` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `decodeSmartSortRuleBundle` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `encodeSmartSortRuleBundle` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `MatchSmartSortPatternErr` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `MatchSmartSortPatternOk` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `ParsedPatternInput` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortHighlightMatchInput` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortHighlightSegment` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortPatternMatch` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRuleBundleDocument` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `smartSortRuleBundleDocumentSchema` | reexport |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRuleBundleRule` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRuleErrorCode` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRulePreviewDraft` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRulePreviewLine` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRulePreviewResult` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `SmartSortRuleValidationFields` | type |
| `packages/core/src/public/smart-sort-rule.ts` | `updateSmartSortRuleSchema` | reexport |
| `packages/core/src/public/vfs.ts` | `actionXmlToToolUses` | reexport |
| `packages/core/src/public/vfs.ts` | `BatchApplyOptions` | type |
| `packages/core/src/public/vfs.ts` | `BatchConflict` | type |
| `packages/core/src/public/vfs.ts` | `BatchExportFileEntry` | type |
| `packages/core/src/public/vfs.ts` | `BatchExportPlan` | type |
| `packages/core/src/public/vfs.ts` | `BatchIngestPlan` | type |
| `packages/core/src/public/vfs.ts` | `BatchIngestPlanEntry` | type |
| `packages/core/src/public/vfs.ts` | `buildUserVfsActionXml` | reexport |
| `packages/core/src/public/vfs.ts` | `buildUserVfsSaveEditActionXml` | reexport |
| `packages/core/src/public/vfs.ts` | `buildUserVfsSaveWriteActionXml` | reexport |
| `packages/core/src/public/vfs.ts` | `buildUserVfsSimpleActionXml` | reexport |
| `packages/core/src/public/vfs.ts` | `CHARACTER_CARD_MAX_FILE_COUNT` | reexport |
| `packages/core/src/public/vfs.ts` | `CHARACTER_CARD_MAX_SINGLE_FILE_BYTES` | reexport |
| `packages/core/src/public/vfs.ts` | `CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES` | reexport |
| `packages/core/src/public/vfs.ts` | `CharacterCardErrorCode` | type |
| `packages/core/src/public/vfs.ts` | `CharacterCardImportService` | type |
| `packages/core/src/public/vfs.ts` | `copyVfsPath` | reexport |
| `packages/core/src/public/vfs.ts` | `CopyVfsPathOptions` | type |
| `packages/core/src/public/vfs.ts` | `CreateCharacterCardImportServiceOptions` | type |
| `packages/core/src/public/vfs.ts` | `DerivedToolUseInput` | type |
| `packages/core/src/public/vfs.ts` | `joinTargetLogicalPath` | reexport |
| `packages/core/src/public/vfs.ts` | `mapUserSaveToToolUses` | reexport |
| `packages/core/src/public/vfs.ts` | `MdTree` | type |
| `packages/core/src/public/vfs.ts` | `mkdirIgnoreExistingDirectory` | reexport |
| `packages/core/src/public/vfs.ts` | `mkdirIgnoreExists` | reexport |
| `packages/core/src/public/vfs.ts` | `normalizeBatchRelativePath` | reexport |
| `packages/core/src/public/vfs.ts` | `normalizeDirPath` | reexport |
| `packages/core/src/public/vfs.ts` | `parseVfsZip` | reexport |
| `packages/core/src/public/vfs.ts` | `projectVfsPrefix` | reexport |
| `packages/core/src/public/vfs.ts` | `relativePathUnderAnchor` | reexport |
| `packages/core/src/public/vfs.ts` | `replaceVfsSubtree` | reexport |
| `packages/core/src/public/vfs.ts` | `scopePhysicalPrefix` | reexport |
| `packages/core/src/public/vfs.ts` | `UserVfsEditHunk` | type |
| `packages/core/src/public/vfs.ts` | `UserVfsSaveMappingOptions` | type |
| `packages/core/src/public/vfs.ts` | `UserVfsSaveMappingResult` | type |
| `packages/core/src/public/vfs.ts` | `VfsBatchIoService` | type |
| `packages/core/src/public/vfs.ts` | `VfsContentSize` | type |
| `packages/core/src/public/vfs.ts` | `VfsEntry` | type |
| `packages/core/src/public/vfs.ts` | `VfsEntryKind` | type |
| `packages/core/src/public/vfs.ts` | `VfsEntryNameValidation` | type |
| `packages/core/src/public/vfs.ts` | `VfsErrorCode` | type |
| `packages/core/src/public/vfs.ts` | `VfsGrepMatch` | type |
| `packages/core/src/public/vfs.ts` | `VfsReadResult` | type |
| `packages/core/src/public/vfs.ts` | `VfsZipErrorCode` | type |
| `packages/core/src/public/vfs.ts` | `VfsZipIoService` | type |
| `packages/core/src/public/vfs.ts` | `ZipPathOptions` | type |
| `packages/core/src/public/workplace.ts` | `AssembleWorkplaceDisplayDeps` | reexport |
| `packages/core/src/public/workplace.ts` | `AssembleWorkplaceDisplayOptions` | reexport |
| `packages/core/src/public/workplace.ts` | `AssembleWorkplaceDisplayResult` | reexport |
| `packages/core/src/public/workplace.ts` | `diffWorkplacePaths` | reexport |
| `packages/core/src/public/workplace.ts` | `DisplayState` | type |
| `packages/core/src/public/workplace.ts` | `evaluateWorkplaceRuleView` | reexport |
| `packages/core/src/public/workplace.ts` | `filetreeMacroLoadStateLabel` | reexport |
| `packages/core/src/public/workplace.ts` | `formatLocalMtime` | reexport |
| `packages/core/src/public/workplace.ts` | `isWorkplacePathLoadedInCache` | reexport |
| `packages/core/src/public/workplace.ts` | `MarkdownFrontMatterSplit` | reexport |
| `packages/core/src/public/workplace.ts` | `parseRuleSnapshotJson` | reexport |
| `packages/core/src/public/workplace.ts` | `RefreshRuleSnapshotDeps` | reexport |
| `packages/core/src/public/workplace.ts` | `renderFileBlockBody` | reexport |
| `packages/core/src/public/workplace.ts` | `RuleSnapshotEntry` | reexport |
| `packages/core/src/public/workplace.ts` | `ruleStateLabel` | reexport |
| `packages/core/src/public/workplace.ts` | `ruleViewToSnapshotEntries` | reexport |
| `packages/core/src/public/workplace.ts` | `SetFileRuleInput` | type |
| `packages/core/src/public/workplace.ts` | `TemplatePullService` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceDirRuleRow` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceFileRuleRow` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceLivePath` | reexport |
| `packages/core/src/public/workplace.ts` | `WorkplaceLiveView` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceMaterialized` | type |
| `packages/core/src/public/workplace.ts` | `WorkplacePersistBlock` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceRuleContext` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceRuleRow` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceRuleView` | type |
| `packages/core/src/public/workplace.ts` | `WorkplaceScope` | type |

## 五、方法与已知局限

- **（F-synth-dead-1 口径）§三 表的定义已排除 `relayed`**：原判定式 `prod === 0 && test > 0`
  漏掉「生产侧经 `export {} from` 转发消费」这条边，会把「生产侧经 `public/**` barrel 消费 + 测试侧直引源文件」
  的符号误判进本桶（实测 core 356 行里 127 行属此类，占 35.7%）。本轮已剔除。
  ⚠ **本表不等于删除清单**：桶定义修对了，但「零生产消费方」≠「可删」——
  快照面（F-synth-dead-2 / ★1）与 barrel 转出侧各有独立约束，本条**不解除任何 blocked**。


- 导出抽取用正则（`export const/function/class/type/interface/enum` + `export {}` 列表 + `export * from`），不做 AST 语义分析；`export default` 不计入。
- 消费判定按「import 说明符解析到的物理文件 + 符号名」精确匹配，因此同名符号不会互相顶替；但若某处用 `import * as ns` 再 `ns.X` 动态取用，本机位会判为零消费（已通过把未解析说明符里的同名符号标 suspect 来兜底）。
- 测试文件内的 `import` 计入消费（口径含测试）；`test/` 与 `__tests__/` 下的 helper 导出不算生产导出。
- 动态 `import(...)` / `require(...)` 只在能解析到仓库内文件时计入边，不解析符号名。
- `apps/mobile/test-utils/**` 是测试用 mock/shim（jest moduleNameMapper 目标），本机位按「非 test/ 目录」口径把它们算作生产文件，故其导出大量出现在零消费清单里；W3 判读时应先排除该目录再定级。
- 自校验：对「确认死」清单中的每条，反查是否存在任一 import 解析后指向该文件且符号同名的情况——实测 0 条不一致（即清单不含「其实有人 import 只是路径没解析到」的漏判）。
- 自校验抽样：对 core 的零消费项按步长抽 40 条做全文字符串 grep，凡只在 barrel `export {}` 列表中出现、无人从该 barrel 引入的，判为真死导出。