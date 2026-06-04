export const PACKAGE_NAME = "@novel-master/core";

export function greet(name: string): string {
  return `Hello, ${name} from ${PACKAGE_NAME}`;
}

/**
 * MyBatis-style dynamic SQL template parsing (`SqlTemplateParser`, `#{...}`, `${...}`).
 *
 * @remarks
 * `${name}` placeholders embed raw strings into SQL and are not bound as parameters.
 * Callers must validate or allow-list values used with `${...}` to avoid SQL injection.
 */
export {
  SqlTemplateParser,
  SqlTemplateError,
  parseTemplateToAst,
  normalizeExpression,
  bindExpressionToContext,
  evaluateTest,
} from "./infra/sql-template/index.js";
export type { EvaluateTestOptions } from "./infra/sql-template/index.js";
export type {
  SqlParseResult,
  ParseOptions,
  SqlTemplateErrorCode,
  AstNode,
} from "./infra/sql-template/index.js";

/**
 * TDBC: async SQLite connectivity protocol (drivers register separately).
 */
export {
  TdbcError,
  open,
  parseUrl,
  registerDriver,
  getDriver,
  listDrivers,
  resolveDriver,
  normalizeBindings,
  executeTemplate,
  queryTemplate,
} from "./infra/tdbc/index.js";
export type {
  TdbcConnection,
  TdbcDriver,
  TdbcErrorCode,
  SqlValue,
  Row,
  ExecuteResult,
  BatchResult,
  OpenOptions,
  ParsedTdbcUrl,
} from "./infra/tdbc/index.js";

/**
 * Virtual file system: path-keyed content with optimistic versioning.
 */
export { VfsError, isVfsError } from "./errors/vfs-errors.js";
export type { VfsErrorCode } from "./errors/vfs-errors.js";
export {
  SessionFsError,
  isSessionFsError,
  sessionFsRollbackLegacyBatch,
  sessionFsRollbackSnapshotMissing,
  sessionFsRollbackMessageNotFound,
  sessionFsRollbackMessageSessionMismatch,
} from "./errors/session-fs-errors.js";
export type { SessionFsErrorCode } from "./errors/session-fs-errors.js";
export type {
  VfsEntry,
  VfsEntryKind,
  VfsStorageKind,
} from "./domain/vfs/model/vfs-entry.js";
export type { VfsListEntry } from "./domain/vfs/model/vfs-list-entry.js";
export {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
} from "./bootstrap/novel-master-bootstrap.js";
export { createVfsService } from "./service/vfs/create-vfs-service.js";
export { createScopedVfsService } from "./service/vfs/create-scoped-vfs-service.js";
export { createVfsZipIoService } from "./service/vfs/create-vfs-zip-io-service.js";
export { parseVfsZip } from "./domain/vfs/logic/vfs-zip-parse.js";
export { VfsZipError } from "./errors/vfs-zip-errors.js";
export type { VfsZipErrorCode } from "./errors/vfs-zip-errors.js";
export type {
  VfsZipIoService,
  VfsZipImportOptions,
} from "./domain/vfs/ports/vfs-zip-io.port.js";
export { resolveAgentToolRegistry } from "./domain/agent/logic/resolve-agent-tool-registry.js";
export { validateAgentToolPolicy } from "./domain/agent/logic/validate-agent-tool-policy.js";
export type {
  AgentToolPolicy,
} from "./domain/agent/model/agent-definition.js";
export type {
  VfsService,
  VfsReadResult,
  WriteOptions,
  VfsGrepMatch,
} from "./domain/vfs/ports/vfs-service.port.js";
export type { VfsScope } from "./domain/vfs/logic/vfs-path-mapper.js";
export {
  resolveLogicalPath,
  assertLogicalPathAllowed,
  toPhysicalPath,
  toLogicalPath,
  scopePhysicalPrefix,
  projectVfsPrefix,
} from "./domain/vfs/logic/vfs-path-mapper.js";

/**
 * Tool system: schema-validated registry + runner, plus builtin `vfs.*` tools.
 */
export type { Tool } from "./domain/tool/model/tool.js";
export { ToolError } from "./errors/tool-errors.js";
export type { ToolErrorCode } from "./errors/tool-errors.js";
export { ToolRegistry } from "./domain/tool/logic/tool-registry.js";
export { ToolRunner } from "./domain/tool/logic/tool-runner.js";
export { createVfsTools, registerVfsTools } from "./domain/tool/builtin/vfs-tools.js";
export type { VfsToolContext } from "./domain/tool/builtin/vfs-tools.js";

/**
 * Persistent workspace pointers and behavioral preferences (KKV-backed, modules internal).
 */
export { KkvError, isKkvError } from "./errors/kkv-errors.js";
export type { KkvErrorCode } from "./errors/kkv-errors.js";
export { createKkvService } from "./service/kkv/create-kkv-service.js";
export type { KkvService } from "./service/kkv/kkv.port.js";
export { PreferencesError } from "./errors/preferences-errors.js";
export type { PreferencesErrorCode } from "./errors/preferences-errors.js";
export { createPersistentState } from "./service/persistent-state/create-persistent-state.js";
export type { PersistentState } from "./service/persistent-state/persistent-state.port.js";
export { createPersistentPreferences } from "./service/persistent-preferences/create-persistent-preferences.js";
export type { PersistentPreferences } from "./service/persistent-preferences/persistent-preferences.port.js";

/**
 * Chat: projects, sessions, messages.
 */
export { ChatError } from "./errors/chat-errors.js";
export type { ChatErrorCode } from "./errors/chat-errors.js";
export type { ChatProject } from "./domain/chat/model/project.js";
export type { ChatSession } from "./domain/chat/model/session.js";
export type {
  ChatMessage,
  MessageContent,
} from "./domain/chat/model/message.js";
export type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ImageSource,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
} from "./domain/chat/model/content-block.js";
export { textBlocks } from "./domain/chat/content/text-blocks.js";
export {
  parseMessageContent,
  assertMessageContent,
} from "./domain/chat/content/parse-message-content.js";
export { formatMessageForCli } from "./domain/chat/content/format-message-cli.js";
export {
  createProjectService,
  createSessionService,
  createMessageService,
} from "./service/chat/create-chat-services.js";
export type { ProjectService } from "./service/chat/project.port.js";
export type { SessionService } from "./service/chat/session.port.js";
export type { MessageService } from "./service/chat/message.port.js";

/**
 * Session file system: execute batches, snapshots, rollback.
 */
export { createSessionFsService } from "./service/session-fs/create-session-fs-service.js";
export type {
  SessionFsService,
  SessionFsActor,
  SessionFsAction,
  SessionFsExecuteOptions,
  SessionFsExecuteRound,
  SessionFsExecuteResult,
  SessionFsBatchSummary,
  SessionFsSnapshotSummary,
} from "./service/session-fs/session-fs.port.js";

/**
 * Virtual worktree: display rules, list, and template inheritance.
 */
export type {
  WorktreeScope,
  RuleState,
  InclusionMode,
  DisplayState,
  SortField,
  SortOrder,
  FillPolicy,
  WorktreeListRow,
  WorktreeDirRule,
  SetDirRuleInput,
  SetFileRuleInput,
} from "./domain/worktree/model/worktree-types.js";
export {
  mapProjectWorktreePathToSession,
  mapSessionWorktreePathToProject,
} from "./domain/worktree/logic/worktree-path-map.js";
export {
  evaluateFileDisplay,
  computeHeadTailIndices,
  sortDirPaths,
  sortFilesForDir,
} from "./domain/worktree/logic/worktree-eval.js";
export { DEFAULT_WORKTREE_DIR_RULE } from "./domain/worktree/logic/default-dir-rule.js";
export {
  renderFileBlock,
  joinFileBlocks,
  formatLocalMtime,
} from "./domain/worktree/logic/worktree-display.js";
export {
  renderWorktreeFileTree,
  worktreeFileTreeRootLabel,
} from "./domain/worktree/logic/worktree-file-tree.js";
export {
  parseMarkdownFrontMatter,
  splitMarkdownFrontMatter,
  type MarkdownFrontMatterSplit,
} from "./domain/worktree/logic/front-matter.js";
export { replaceVfsSubtree } from "./domain/vfs/logic/vfs-tree-copy.js";
export { createWorktreeService } from "./service/worktree/create-worktree-service.js";
export type {
  WorktreeService,
  WorktreeMaterialized,
} from "./service/worktree/worktree.port.js";
export { createTemplatePullService } from "./service/template/create-template-pull-service.js";
export type { TemplatePullService } from "./service/template/template-pull.port.js";

/**
 * Prompt engine: YAML blocks, macros, and plain-text rendering.
 */
export { PromptError } from "./errors/prompt-errors.js";
export type { PromptErrorCode } from "./errors/prompt-errors.js";
export type {
  PromptBlock,
  PromptBlockRole,
} from "./domain/prompt/model/prompt-block.js";
export { messageBodyText } from "./domain/prompt/logic/message-body.js";
export {
  validatePromptBlocks,
  validatePromptBlocksFromMap,
} from "./domain/prompt/logic/validate-prompt-blocks.js";
export {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
  buildPromptPreviewSegments,
} from "./service/prompt/render-prompt.js";
export type {
  PromptRenderContext,
  PromptRenderDot,
  PromptMacroContext,
  PromptLlmInput,
  PromptPreviewSegment,
} from "./service/prompt/render-prompt.js";
export { parseText, type TextFormat } from "./infra/serialization/parse-text.js";
export { stringifyText } from "./infra/serialization/stringify-text.js";
export { decode } from "./infra/serialization/decode.js";
export { encode, type EncodableSchema } from "./infra/serialization/encode.js";
export { ConfigDecodeError } from "./errors/config-decode-errors.js";
export type { ConfigDecodeErrorCode } from "./errors/config-decode-errors.js";
export { loadPromptBlocksFromYaml } from "./domain/prompt/logic/load-prompt-blocks-from-yaml.js";
export type { AgentDefinition } from "./domain/agent/model/agent-definition.js";
export {
  agentDefinitionSchema,
  agentDefinitionDocumentSchema,
  promptsDocumentSchema,
} from "./domain/agent/model/agent-definition.schema.js";
export {
  validateAgentDefinition,
  type ValidateAgentDefinitionOptions,
} from "./domain/agent/logic/validate-agent-definition.js";
export {
  resolveApplicationModelId,
  resolveSummaryApplicationModelId,
  type ResolveApplicationModelIdInput,
  type ResolveSummaryApplicationModelIdInput,
} from "./domain/agent/logic/resolve-application-model-id.js";
/** In-process typed pub/sub; UI and orchestrator subscribe to lifecycle/stream events. */
export { SimpleEventBus } from "./infra/events/simple-event-bus.js";
export type { EventBus, EventSubscription } from "./infra/events/simple-event-bus.js";
export {
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
  EVENT_SESSION_COMPACTION_REQUESTED,
} from "./domain/events/model/event-types.js";
export type {
  NovelMasterEventType,
  AgentStreamTextDeltaPayload,
  AgentStreamThinkingDeltaPayload,
  AgentStepCommittedPayload,
  AgentStepCommittedPhase,
  SessionCompactionRequestedPayload,
  CompactionTriggerKind,
} from "./domain/events/model/event-types.js";
export type { DepthSlice } from "./domain/depth/logic/depth-slice.js";
export { matchDepth, validateDepthSlice, messageIdsInSlice } from "./domain/depth/logic/depth-slice.js";
export { depthByMessageId, listVisibleForDepth } from "./domain/depth/logic/depth-from-tail.js";
export type {
  EventsConfig,
  EventAction,
  EventActionNode,
  EventActionType,
  RunAgentActionParams,
} from "./domain/events-config/model/events-config.js";
export { eventsConfigSchema } from "./domain/events-config/model/events-config.schema.js";
export { DEFAULT_EVENTS_CONFIG } from "./domain/events-config/logic/default-events.js";
export type { EventsConfigStore } from "./service/events-config/events-config-store.port.js";
export { createEventsConfigStore } from "./service/events-config/create-events-config-store.js";
/** Trigger-only policy (`nm-compaction-conditions`); actions live in events config. */
export type { CompactionConditions } from "./domain/compaction-conditions/model/compaction-conditions.js";
export { compactionConditionsSchema } from "./domain/compaction-conditions/model/compaction-conditions.schema.js";
export { CompactionConditionsError } from "./errors/compaction-conditions-errors.js";
export type { CompactionConditionsStore } from "./service/compaction-conditions/compaction-conditions-store.port.js";
export { createCompactionConditionsStore } from "./service/compaction-conditions/create-compaction-conditions-store.js";
export {
  createCompactionConditionEvaluator,
  type CompactionConditionEvaluator,
} from "./service/compaction-conditions/create-compaction-condition-evaluator.js";
/** Runs actions from `nm-events` config; use {@link createEventOrchestrator} in runtime. */
export type { EventOrchestrator, EventEmitContext } from "./service/events/event-orchestrator.port.js";
export {
  createEventOrchestrator,
  createRunAgentHandlerDeps,
} from "./service/events/create-event-orchestrator.js";
export type { EventRunResult, EventActionFailure } from "./service/events/event-run-result.js";
export { EventsError } from "./errors/events-errors.js";
export type { SessionMacroCache, SessionMacroSnapshot } from "./service/prompt/session-macro-cache.port.js";
export { createSessionMacroCache } from "./service/prompt/create-session-macro-cache.js";
export type { AgentRegistryService } from "./service/agent/agent-registry.port.js";
export { createAgentRegistryService } from "./service/agent/create-agent-registry-service.js";
export { AgentConfigError } from "./errors/agent-config-errors.js";
export type { AgentConfigErrorCode } from "./errors/agent-config-errors.js";
export type {
  ModelSamplingParams,
  OpenAiSamplingParams,
  AnthropicSamplingParams,
  GeminiSamplingParams,
} from "./domain/provider/model/model-sampling-params.js";
export { samplingProtocol } from "./domain/provider/model/model-sampling-params.js";
export {
  mergeSamplingWithDefaults,
  maxOutputTokensFromSampling,
  OPENAI_SAMPLING_DEFAULTS,
  ANTHROPIC_SAMPLING_DEFAULTS,
  GEMINI_SAMPLING_DEFAULTS,
} from "./domain/provider/model/protocol-sampling-defaults.js";
export type { ModelSamplingProfile } from "./domain/provider/model/model-sampling-profile.js";
export {
  modelSamplingProfileFromJson,
  modelSamplingProfileToJson,
} from "./domain/provider/model/model-sampling-profile-from-json.js";
export type { ModelSamplingProfileService } from "./service/provider/model-sampling-profile.port.js";
export { createModelSamplingProfileService } from "./service/provider/create-model-sampling-profile-service.js";
export type {
  ModelRetryPolicy,
  ModelRetryPolicyService,
} from "./service/provider/model-retry-policy.port.js";
export { createModelRetryPolicyService } from "./service/provider/create-model-retry-policy-service.js";
export { formatLocalDateTime } from "./infra/date-format.js";

/**
 * LLM providers, models, and protocol adapters.
 */
export { ProviderError } from "./errors/provider-errors.js";
export type { ProviderErrorCode } from "./errors/provider-errors.js";
export type { SecretStore } from "./infra/sksp/index.js";
export {
  parseApplicationModelId,
  formatApplicationModelId,
  normalizeVendorModelId,
} from "./domain/provider/logic/application-model-id.js";
export type { LlmProvider } from "./domain/provider/model/provider.js";
export { providerApiKeyRef } from "./domain/provider/model/provider.js";
export type {
  LlmProtocolKind,
  LlmToolDefinition,
  LlmStreamEvent,
  LlmTokenUsage,
} from "./infra/llm-protocol/ports/adapter.port.js";
export { toolsFromRegistry } from "./infra/llm-protocol/logic/tool-definitions.js";
export { zodToJsonSchema } from "./infra/serialization/zod-to-json-schema.js";
/** @internal CLI e2e fetch capture */
export {
  clearProtocolAdapters,
  configureLlmFetch,
  getProtocolAdapter,
} from "./infra/llm-protocol/logic/registry.js";
export {
  createLoggingFetch,
  isLlmFetchDebugEnabled,
} from "./infra/llm-protocol/logic/debug-fetch.js";
export type { AgentSession } from "./domain/agent/session/agent-session.port.js";
export { AgentError } from "./errors/agent-runtime-errors.js";
export type { AgentErrorCode } from "./errors/agent-runtime-errors.js";
export type {
  AgentRunResult,
  ModelRoundSummary,
} from "./domain/agent/model/agent-run-result.js";
export {
  DOOM_LOOP_THRESHOLD,
  CROSS_ROUND_WINDOW,
  assertNoDoomLoopInBlocks,
  assertNoCrossRoundDoomLoop,
} from "./domain/agent/logic/doom-loop.js";
export { InMemoryAgentSession } from "./domain/agent/session/impl/in-memory-agent-session.js";
export { ChatAgentSession } from "./service/agent/impl/chat-agent-session.js";
export type { AgentRunner, AgentRunOptions } from "./service/agent/agent.port.js";
export { createAgentRunner } from "./service/agent/create-agent-runner.js";
export type { CreateAgentRunnerDeps } from "./service/agent/create-agent-runner.js";
export { estimateTokens } from "./domain/compaction-conditions/logic/token-estimate.js";
export {
  createDefaultTokenCounterRegistry,
  HeuristicTokenCounter,
  serializePromptLlmInput,
  type TokenCounter,
  type TokenCounterRegistry,
  type TokenCounterKind,
  type CreateDefaultTokenCounterRegistryDeps,
} from "./infra/tokenizer/index.js";
export { createProviderServices } from "./service/provider/create-provider-services.js";
export type { ProviderServiceBundle } from "./service/provider/create-provider-services.js";
export type {
  ProviderService,
  ProviderListItem,
  CreateProviderInput,
  EditProviderPatch,
} from "./service/provider/provider.port.js";
export type { ProviderModelService } from "./service/provider/provider-model.port.js";
export type { ModelRequestService } from "./service/provider/model-request.port.js";

/**
 * Regex groups/rules (SQLite entities) and view-time replacement pipeline.
 */
export { RegexError } from "./errors/regex-errors.js";
export type { RegexErrorCode } from "./errors/regex-errors.js";
export type { RegexGroup } from "./domain/regex/model/regex-group.js";
export type { RegexRule } from "./domain/regex/model/regex-rule.js";
export type { CompiledRegexRule } from "./domain/regex/logic/compile-regex-rule.js";
export { compileRegexRule } from "./domain/regex/logic/compile-regex-rule.js";
export {
  applyRegexRules,
  applyRegexToMessageContent,
  applyRegexChannelToMessages,
} from "./domain/regex/logic/apply-regex-rules.js";
export type { RegexChannel } from "./domain/regex/logic/apply-regex-rules.js";
export { listVisibleSorted } from "./domain/chat/logic/message-visible-floor.js";
export { validateRegexRule, validateRegexRuleEntity } from "./domain/regex/logic/validate-regex-rule.js";
export {
  createRegexRuleSchema,
  updateRegexRuleSchema,
  createRegexGroupSchema,
  updateRegexGroupSchema,
} from "./domain/regex/model/regex-rule.schema.js";
export type {
  CreateRegexRuleInput,
  UpdateRegexRuleInput,
  CreateRegexGroupInput,
  UpdateRegexGroupInput,
} from "./domain/regex/model/regex-rule.schema.js";
export { resolveActiveCompiledRules } from "./domain/regex/logic/resolve-active-regex-rules.js";
export { createRegexConfigService } from "./service/regex/create-regex-config-service.js";
export type { RegexConfigService } from "./service/regex/regex-config.port.js";
