# p27 R2 — 全仓 class 定性收敛探针

> 探针范围：`packages/**`、`apps/mobile/src`、`apps/desktop`、`tools`（`apps/cli` 按约定排除，#276）。
> 判定矩阵沿用 spec：`extends Error` 保留 / 端口实现保留 / 有真实状态保留 / 无状态纯函数集收编 / 疑似无状态但有共享字段 REVIEW。
> 逐类读实现定性，未修改任何源码。

## 一、总数与三桶分布

生产代码 class 共 **127** 个（另有 11 个测试辅助类 + 2 个 .d.ts 环境声明，见附录，不在定性范围）。

| 桶 | 数量 | 占比 |
|---|---|---|
| 保留 | 115 | 90.6% |
| 收编（namespace 候选） | 11 | 8.7% |
| REVIEW | 1 | 0.8% |

保留桶细分：

| 子类 | 数量 |
|---|---|
| A. `extends Error`/`AppError`（控制流哨兵，p19 裁决） | 12 |
| I. `implements` 端口契约（含 1 个结构化满足端口族，p17 V4 裁决） | 72 |
| B. `extends` 抽象基类/继承族 | 6 |
| S. 有真实共享可变状态或构造注入的实例生命周期 | 18 |
| V. 值对象（构造携带数据，方法依赖实例字段） | 3 |
| F. 框架契约（React Component / CodeMirror ViewPlugin） | 2 |
| INFRA. infra 封装（spec 点名族 / 构造配置字段） | 2 |

## 二、收编桶（11 个，完整清单）

全部为「无状态 + 非接口 + 无继承」的纯函数集，均为模块内 `new` 一次的单例消费（`export const xxx = new Xxx()`），方法无 `this` 字段读写。收编后按 p25/p26 规则：namespace 承载成员、单例出口替换为 namespace 函数调用。

| # | 类名 | 文件（packages/core/src 相对） | 定性依据 | 涉及文件数（类文件 + 消费方，含测试） |
|---|---|---|---|---|
| 1 | `SkillToolRefResolver` | domain/chat/logic/skill-tool-ref.ts | 无字段，fromInput/fromOutput 纯解析 | 8（+7：core build-tool-result-block、public/chat.ts 桶、desktop message-blocks、desktop shared chat.ts、mobile message-blocks、mobile webview skill-tool-ref、core test） |
| 2 | `ChatLinkResolver` | domain/chat/logic/resolve-chat-link-target.ts | 无字段，isHttp/resolve/elidePath/notFoundMessage 纯函数 | 11（+10：desktop chat-link-route、ShellNavProvider、main.ts、shared chat.ts、mobile chat-link-nav、useChatTabScope、SubagentSessionScreen、public/chat.ts 桶、desktop test、core test） |
| 3 | `ForkCopySeeder` | domain/chat/logic/fork-copy-seeder.ts | 单方法 seed，repo 在方法内自建，无字段 | 5（+4：sqlite-message-checkpoint.repository、message.service、session.service、perf test） |
| 4 | `DirAttachTreeRenderer` | domain/chat/logic/attachment/render-dir-attach-tree.ts | 单方法 render，无字段 | 3（+2：attachment-hydrator、core test） |
| 5 | `AttachmentScanner` | domain/chat/logic/attachment/attachment-scanner.ts | 无字段，scan/merge/fromPaths 纯函数（模块内正则常量非实例状态） | 16（+15：composer-send-policy、attachment-hydrator、prompt-assembler、subagent-tool、run-agent-turn、public/chat.ts 桶、desktop shared chat.ts、mobile composer-send-scan、useChatComposerController、5 个 core test、desktop test） |
| 6 | `AttachmentXmlCodec` | domain/chat/logic/attachment/attachment-xml-codec.ts | 无字段，encode/decode 纯编解码 | 13（+12：attachment-hydrator、run-agent-turn、public/chat.ts 桶、desktop rollback-annotate-restore、shared chat.ts、useChatTabMessageActions、5 个 core test、desktop test） |
| 7 | `UserMessageFormatter` | domain/chat/logic/prompt/user-message-formatter.ts | 单方法 wrapForLlm，无字段 | 6（+5：attachment-hydrator、public/chat.ts 桶、3 个 core test） |
| 8 | `PromptAssembler` | domain/chat/logic/prompt/prompt-assembler.ts | 单方法 prepare，状态全部为方法内局部变量（seen/budget/hydrator 每次新建） | 10（+9：agent-runner、desktop/mobile session-prompt-input.service、public/chat.ts 桶、5 个 core test） |
| 9 | `UserVfsTurns` | domain/chat/logic/vfs-turn/user-vfs-turn-view.ts | 无字段，parseActions/deriveToolUses/matchAt/buildView 纯函数 | 3（+2：attachment-xml-codec、core test） |
| 10 | `ComposerSendPolicy` | domain/chat/logic/composer/composer-send-policy.ts | 单方法 evaluate，无字段 | 9（+8：desktop ChatComposer、composer-send-intent、shared chat.ts、mobile useChatComposerController、public/chat.ts 桶、2 个 test） |
| 11 | `RollbackConfirmView` | presentation/chat/rollback-confirm.ts | 单方法 descriptor，无字段 | 5（+4：desktop ConversationPanel、shared chat.ts、mobile useChatTabMessageActions、core test） |

**收编工作量预估**：逐类触碰 3–16 个文件、合计约 89 次文件触碰；去重后（attachment-hydrator / shared chat.ts / public/chat.ts 桶 / useChatTabMessageActions 等消费多个单例）**唯一涉及文件约 61 个**（11 个类文件 + 生产消费方约 33 + 测试约 17）。收编链集中在 `domain/chat/logic` 一族与 `public/chat.ts` 桶，可按文件聚类分 3–4 个 wave 并行收编。

## 三、REVIEW 桶（1 个）

| 类名 | 文件 | 争议点 |
|---|---|---|
| `TemplateParser` | packages/core/src/infra/sql-template/parser.ts | 唯一字段 `astCache` 是**纯缓存**（同模板复用 AST）。按「字段非纯缓存才算有状态」应视为疑似无状态+方法间共享字段 → REVIEW；按「infra 封装族保留」（与 spec 点名的 `SqlTemplateParser` 同管线、文档自称 Stateful parser）应保留。两读法冲突，p27 不收、由裁决者定夺。 |

## 四、保留桶（115 个，完整定性表）

判定要点：`extends Error` → A；`implements` → I；构造存字段且方法读写（非纯缓存）→ S；值对象 → V；框架要求 class 形态 → F。

### A. extends Error / AppError — 控制流哨兵（12）

| 类名 | 文件 | 备注 |
|---|---|---|
| `AssertionError` | packages/core/src/common/assert.ts | assert 失败哨兵 |
| `AppError` | packages/core/src/errors/app-error.ts | 全仓错误基座（key 泛型） |
| `MutatingPathRestoreCompositeError` | packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts | extends AppError |
| `DatabaseReplacedError` | packages/core/src/infra/cloud-sync/model/database-replaced-error.ts | 换库信号 |
| `SkspError` | packages/core/src/infra/sksp/sksp-error.ts | SKSP 错误 |
| `SqlTemplateError` | packages/core/src/infra/sql-template/errors.ts | 模板错误 |
| `TdbcError` | packages/core/src/infra/tdbc/errors.ts | 驱动错误 |
| `CoordinatedWriteRollbackError` | packages/core/src/service/coordinated-write.ts | 回滚聚合错误 |
| `ChatPromptBuildBailedError` | packages/core/src/service/chat/model/chat-prompt-build-bailed-error.ts | prompt 短路 |
| `NativeSseTransportError` | packages/llm-sse-native/src/transport.ts | SSE 传输错误 |
| `NativeSseAbortError` | packages/llm-sse-native/src/transport.ts | SSE 取消 |
| `PromptCountCancelledError` | packages/tokenizer-driver-rn/src/android-native-bridge.ts | token 计数取消 |

### I. implements 端口契约（72）

| 类名 | 文件 | 端口 |
|---|---|---|
| `SqliteAgentDefinitionRepository` | core/src/domain/agent/repositories/impl/sqlite-agent-definition.repository.ts | AgentDefinitionRepository |
| `InMemoryAgentSession` | core/src/domain/agent/session/impl/in-memory-agent-session.ts | AgentSession |
| `SqliteProjectRepository` | core/src/domain/chat/repositories/impl/sqlite-project.repository.ts | ProjectRepository（+extends Base） |
| `SqliteSessionRepository` | core/src/domain/chat/repositories/impl/sqlite-session.repository.ts | SessionRepository（+extends Base） |
| `SqliteMessageRepository` | core/src/domain/chat/repositories/impl/sqlite-message.repository.ts | MessageRepository（+extends Base） |
| `CompositeConditionTrigger` | core/src/domain/compaction-conditions/triggers/composite-trigger.ts | CompactionConditionTrigger |
| `VisibleFloorTrigger` | core/src/domain/compaction-conditions/triggers/visible-floor.trigger.ts | CompactionConditionTrigger |
| `TokenRatioConditionTrigger` | core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts | CompactionConditionTrigger |
| `SqliteKkvRepository` | core/src/domain/kkv/repositories/impl/sqlite-kkv.repository.ts | KkvRepository |
| `SqliteMessageCheckpointRepository` | core/src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.ts | MessageCheckpointRepository |
| `KkvModelSuggestionRepository` | core/src/domain/provider/repositories/impl/kkv-model-suggestion.repository.ts | ModelSuggestionRepository |
| `SqliteProviderRepository` | core/src/domain/provider/repositories/impl/sqlite-provider.repository.ts | ProviderRepository |
| `SqliteSavedModelRepository` | core/src/domain/provider/repositories/impl/sqlite-saved-model.repository.ts | SavedModelRepository |
| `SqliteSessionKkvRepository` | core/src/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.ts | SessionKkvRepository |
| `SqliteSessionRunStateRepository` | core/src/domain/session-run-state/repositories/impl/sqlite-session-run-state.repository.ts | SessionRunStateRepository |
| `SqliteSkillDisabledRuleRepository` | core/src/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.ts | SkillDisabledRuleRepository |
| `SqliteSmartSortRuleRepository` | core/src/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.ts | SmartSortRuleRepository |
| `SqliteUsageRecordRepository` | core/src/domain/usage/repositories/impl/sqlite-usage-record.repository.ts | UsageRecordRepository |
| `SqliteVfsContentStore` | core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts | VfsContentStore |
| `SqliteVfsRevisionRepository` | core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts | VfsRevisionRepository |
| `SqliteVfsEntryRepository` | core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts | VfsEntryRepository |
| `SqliteWorkplaceRepository` | core/src/domain/workplace/repositories/impl/sqlite-workplace.repository.ts | WorkplaceRepository |
| `AnthropicProtocolAdapter` | core/src/infra/llm-protocol/impl/anthropic.adapter.ts | LlmProtocolAdapter |
| `GeminiProtocolAdapter` | core/src/infra/llm-protocol/impl/gemini.adapter.ts | LlmProtocolAdapter |
| `OpenAiProtocolAdapter` | core/src/infra/llm-protocol/impl/openai.adapter.ts | LlmProtocolAdapter |
| `BaseSqliteSecretStore` | core/src/infra/sksp/impl/base-sqlite-secret-store.ts | SecretStore（abstract） |
| `EnvSecretStore` | core/src/infra/sksp/impl/sksp-factory.ts | SecretStore 族（**结构化满足** EnvSecretStoreLike，无 implements 关键字、无字段；端口契约硬约束适用，不收） |
| `HeuristicTokenCounter` | core/src/infra/tokenizer/impl/heuristic-token-counter.ts | TokenCounter |
| `HeuristicOnlyTokenCounterRegistry` | core/src/infra/tokenizer/logic/create-default-registry.ts | TokenCounterRegistry |
| `EphemeralOverlayAgentSession` | core/src/service/agent/impl/ephemeral-overlay-agent-session.ts | AgentSession |
| `DefaultAgentRegistryService` | core/src/service/agent/impl/agent-registry.service.ts | AgentRegistryService |
| `ChatAgentSession` | core/src/service/agent/impl/chat-agent-session.ts | AgentSession |
| `DefaultAgentRunner` | core/src/service/agent/impl/agent-runner.ts | AgentRunnerPort |
| `DefaultMessageTranscriptEffectsService` | core/src/service/chat/impl/message-transcript-effects.service.ts | MessageTranscriptEffectsService |
| `DefaultUserVfsTurnService` | core/src/service/chat/impl/user-vfs-turn.service.ts | UserVfsTurnService |
| `DefaultProjectService` | core/src/service/chat/impl/project.service.ts | ProjectService |
| `DefaultMessageService` | core/src/service/chat/impl/message.service.ts | MessageService |
| `DefaultSessionService` | core/src/service/chat/impl/session.service.ts | SessionService |
| `DefaultUsageStatsService` | core/src/service/chat/impl/usage-stats.service.ts | UsageStatsService |
| `DefaultCompactionConditionsStore` | core/src/service/compaction-conditions/impl/compaction-conditions-store.service.ts | CompactionConditionsStore |
| `DefaultKkvService` | core/src/service/kkv/impl/kkv.service.ts | KkvService |
| `DefaultMessageCheckpointService` | core/src/service/message-checkpoint/impl/message-checkpoint.service.ts | MessageCheckpointService |
| `DefaultMessageRollbackService` | core/src/service/message-checkpoint/impl/message-rollback.service.ts | MessageRollbackService |
| `DefaultPersistentPreferences` | core/src/service/persistent-preferences/impl/persistent-preferences.service.ts | PersistentPreferences |
| `DefaultPersistentState` | core/src/service/persistent-state/impl/persistent-state.service.ts | PersistentState |
| `DefaultModelRetryPolicyService` | core/src/service/provider/impl/model-retry-policy.service.ts | ModelRetryPolicyService |
| `DefaultModelRequestService` | core/src/service/provider/impl/model-request.service.ts | ModelRequestService |
| `DefaultProviderService` | core/src/service/provider/impl/provider.service.ts | ProviderService |
| `DefaultProviderModelService` | core/src/service/provider/impl/provider-model.service.ts | ProviderModelService |
| `DefaultSessionFsService` | core/src/service/session-fs/impl/session-fs.service.ts | SessionFsService |
| `SkillsService` | core/src/service/skills/impl/skills.service.ts | SkillService |
| `DefaultSmartSortRuleService` | core/src/service/smart-sort-rule/impl/smart-sort-rule.service.ts | SmartSortRuleService |
| `DefaultTemplatePullService` | core/src/service/template/impl/template-pull.service.ts | TemplatePullService |
| `DefaultVfsService` | core/src/service/vfs/impl/vfs.service.ts | InternalVfsService |
| `DefaultVfsZipIoService` | core/src/service/vfs/impl/vfs-zip-io.service.ts | VfsZipIoService |
| `DefaultVfsBatchIoService` | core/src/service/vfs/impl/vfs-batch-io.service.ts | VfsBatchIoService |
| `DefaultPhysicalVfsService` | core/src/service/vfs/impl/physical-vfs.service.ts | PhysicalVfsService |
| `RevisionAwareVfsService` | core/src/service/vfs/impl/revision-aware-vfs.service.ts | InternalVfsService |
| `DefaultCharacterCardImportService` | core/src/service/vfs/impl/character-card-import.service.ts | CharacterCardImportService |
| `DefaultWorkplaceService` | core/src/service/workplace/impl/workplace.service.ts | WorkplaceService |
| `ScopedVfsService` | core/src/service/vfs/impl/scoped-vfs.service.ts | VfsService |
| `BetterSqlite3Driver` | packages/tdbc-driver-better-sqlite3/src/driver.ts | TdbcDriver |
| `BetterSqlite3Connection` | packages/tdbc-driver-better-sqlite3/src/connection.ts | TdbcConnection |
| `TransactionalConnection`（better） | packages/tdbc-driver-better-sqlite3/src/connection.ts | TdbcConnection（spec 点名有状态） |
| `OpSqliteDriver` | packages/tdbc-driver-op-sqlite/src/driver.ts | TdbcDriver |
| `OpSqliteConnection` | packages/tdbc-driver-op-sqlite/src/connection.ts | TdbcConnection |
| `TransactionalConnection`（op） | packages/tdbc-driver-op-sqlite/src/connection.ts | TdbcConnection（spec 点名有状态） |
| `OpSqliteDynamicAdapter` | packages/tdbc-driver-op-sqlite/src/impl/op-sqlite-dynamic.adapter.ts | OpSqliteAdapter |
| `BaseOpSqliteAdapter` | packages/tdbc-driver-op-sqlite/src/impl/op-sqlite.adapter.ts | OpSqliteAdapter |
| `WebTokenizerCounter` | packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts | TokenCounter |
| `TiktokenTokenCounter` | packages/tokenizer-driver-node/src/impl/tiktoken-token-counter.ts | TokenCounter |
| `SentencePieceTokenCounter` | packages/tokenizer-driver-node/src/impl/sentencepiece-token-counter.ts | TokenCounter |

### B. extends 抽象基类 / 继承族（6）

| 类名 | 文件 | 备注 |
|---|---|---|
| `BaseSqliteChatRepository<TEntity>` | core/src/domain/chat/repositories/impl/base-sqlite-chat-repository.ts | abstract，3 个 Sqlite repo 的基类 |
| `AndroidSecretStore` | packages/sksp-android/src/android-secret-store.ts | extends BaseSqliteSecretStore |
| `LinuxSqliteSecretStore` | packages/sksp-linux/src/sqlite-secret-store.ts | extends BaseSqliteSecretStore |
| `MacSqliteSecretStore` | packages/sksp-mac/src/sqlite-secret-store.ts | extends BaseSqliteSecretStore |
| `SqliteSecretStore` | packages/sksp-windows/src/sqlite-secret-store.ts | extends BaseSqliteSecretStore |
| `NativeOpSqliteAdapter` | packages/tdbc-driver-op-sqlite/src/impl/op-sqlite-native.adapter.ts | extends BaseOpSqliteAdapter |

### S. 有真实共享可变状态 / 构造注入实例生命周期（18）

| 类名 | 文件 | 状态字段 |
|---|---|---|
| `DoomLoopDetector` | core/src/domain/agent/logic/doom-loop.ts | trajectory（跨步轨迹窗口） |
| `ChatAnnotateDraftStore` | core/src/domain/chat/logic/chat-annotate-draft-store.ts | bySession Map + listeners Set |
| `AttachBudget` | core/src/domain/chat/logic/attachment/attach-budget.ts | used 累加器 |
| `AttachmentHydrator` | core/src/domain/chat/logic/prompt/attachment-hydrator.ts | 构造注入 runtime/seen/workplaceSeen/budget，方法间共享 |
| `UserVfsUnifiedToolTurnFlag` | core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts | 进程级 snapshot |
| `ToolRegistry` | core/src/domain/tool/logic/tool-registry.ts | tools Map |
| `ToolRunner` | core/src/domain/tool/logic/tool-runner.ts | registry 注入（spec 点名保留） |
| `CloudSyncCoordinator` | core/src/infra/cloud-sync/impl/cloud-sync-coordinator.ts | 12 个构造依赖 + pushMutex |
| `PushAgentMutex` | core/src/infra/cloud-sync/logic/push-agent-mutex.ts | heldBy + FIFO waiters |
| `DecodedContentPool` | core/src/infra/content-cache/logic/decoded-content-cache.ts | LRU Map + 计数 |
| `SimpleEventBus` | core/src/infra/events/simple-event-bus.ts | handlers Map |
| `AsyncMutex` | core/src/infra/tdbc/logic/async-mutex.ts | tail promise 链 |
| `IntegrityRepairRegistry` | core/src/service/integrity-repair.ts | operations Map |
| `CoordinatedWrite` | core/src/service/coordinated-write.ts | steps 累积（builder） |
| `AgentActivityTracker` | core/src/service/agent/logic/agent-activity-tracker.ts | refCount + listeners |
| `SessionStreamUnit` | apps/mobile/src/services/session-stream-unit.ts | 大型流式状态机（30+ 可变字段） |
| `SessionStreamUnitManager` | apps/mobile/src/services/session-stream-unit-manager.service.ts | units/订阅/写通/投影 LRU 等 |
| `DesktopCloudSyncService` | apps/desktop/src/main/services/cloud-sync.service.ts | runtime 按代重建生命周期 + configStore |

### V. 值对象（3）

| 类名 | 文件 | 备注 |
|---|---|---|
| `ChatMessage` | core/src/domain/chat/logic/message/chat-message.ts | 13 个 readonly 数据字段 + 派生谓词；private 构造 + static from |
| `Ok` | core/src/errors/either.ts | Result 判别联合成功侧，value 字段 |
| `Err` | core/src/errors/either.ts | Result 判别联合失败侧，error 字段 |

### F. 框架契约（2）

| 类名 | 文件 | 备注 |
|---|---|---|
| `StreamBodyHost` | apps/mobile/src/web/chat-transcript/webview/ui/stream/StreamingMessageRow.tsx | extends React Component |
| `ComposerTokenHighlighter` | apps/mobile/src/web/code-editor/webview/runtime/composer-tokens.ts | CodeMirror `ViewPlugin.fromClass` 要求 class 形态（构造 + update），框架实例化 |

### INFRA. infra 封装族（2）

| 类名 | 文件 | 备注 |
|---|---|---|
| `SqlTemplateParser` | core/src/infra/sql-template/index.ts | spec 点名保留；持有 parser 实例 + placeholder 配置 |
| `TemplateEvaluator` | core/src/infra/sql-template/evaluator.ts | 构造配置字段 `placeholder` 跨方法读取（非缓存），递归自调用 |

## 五、附录：排除项

**测试辅助类（11，不在定性范围）**：`CountingAgentSession`、`DdlProbeConnection`、`TransactionProbe`、`SqlCounter`、`CountingTdbcConnection`、`HangingXhr`×2（core test）、`MockOpSqliteAdapter`（tdbc-driver-op-sqlite test）、`MockKeyboardEvent`×2、`CustomEventStub`（desktop test）。

**环境声明（2，非真实 class）**：`SentencePieceProcessor`、`Tokenizer`（packages/tokenizer-driver-node/src/types/agnai-tokenizers.d.ts，三方类型桩）。

**备注**：
- p19 预估「约 11 个」Error 哨兵，实测 **12** 个（多出 `CoordinatedWriteRollbackError`，包内未导出的聚合错误也算）。
- 全部 11 个收编候选都是 `domain/chat/logic` / `presentation/chat` 一族的「模块级单例」形态（`export const xxx = new Xxx()`），无一处多实例化，收编后调用点改造是纯机械替换（`xxx.method(...)` → `Namespace.method(...)`）。
- `public/chat.ts` 桶再导出了 7 个收编单例（skillToolRefResolver/chatLinkResolver/attachmentScanner/attachmentXmlCodec/userMessageFormatter/promptAssembler/composerSendPolicy），收编时该桶需同步改出口。
