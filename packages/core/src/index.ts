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
export { VfsError } from "./errors/vfs-errors.js";
export type { VfsErrorCode } from "./errors/vfs-errors.js";
export type { VfsEntry, VfsStorageKind } from "./domain/vfs/model/vfs-entry.js";
export {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
} from "./bootstrap/novel-master-bootstrap.js";
export { createVfsService } from "./service/vfs/create-vfs-service.js";
export { createScopedVfsService } from "./service/vfs/create-scoped-vfs-service.js";
export type {
  VfsService,
  VfsReadResult,
  WriteOptions,
  VfsGrepMatch,
} from "./service/vfs/vfs.port.js";
export type { VfsScope } from "./domain/vfs/vfs-path-mapper.js";

/**
 * Tool system: schema-validated registry + runner, plus builtin `vfs.*` tools.
 */
export type { Tool } from "./domain/tool/model/tool.js";
export { ToolError } from "./domain/tool/tool-errors.js";
export type { ToolErrorCode } from "./domain/tool/tool-errors.js";
export { ToolRegistry } from "./domain/tool/tool-registry.js";
export { ToolRunner } from "./domain/tool/tool-runner.js";
export { createVfsTools, registerVfsTools } from "./domain/tool/builtin/vfs-tools.js";
export type { VfsToolContext } from "./domain/tool/builtin/vfs-tools.js";

/**
 * Persistent workspace pointers and behavioral preferences (KKV-backed, modules internal).
 */
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
  SetDirRuleInput,
  SetFileRuleInput,
} from "./domain/worktree/model/worktree-types.js";
export {
  mapProjectWorktreePathToSession,
  mapSessionWorktreePathToProject,
} from "./domain/worktree/worktree-path-map.js";
export {
  evaluateFileDisplay,
  computeHeadTailIndices,
  sortFilesForDir,
} from "./domain/worktree/worktree-eval.js";
export {
  renderFileBlock,
  joinFileBlocks,
  formatLocalMtime,
} from "./domain/worktree/worktree-display.js";
export { parseMarkdownFrontMatter } from "./domain/worktree/front-matter.js";
export { replaceVfsSubtree } from "./domain/vfs/vfs-tree-copy.js";
export { createWorktreeService } from "./service/worktree/create-worktree-service.js";
export type { WorktreeService } from "./service/worktree/worktree.port.js";
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
export { messageBodyText } from "./domain/prompt/message-body.js";
export {
  validatePromptBlocks,
  validatePromptBlocksFromMap,
} from "./domain/prompt/prompt-blocks-validate.js";
export {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
} from "./service/prompt/render-prompt.js";
export type {
  PromptRenderContext,
  PromptRenderDot,
  PromptLlmInput,
} from "./service/prompt/render-prompt.js";
export { parseText, type TextFormat } from "./infra/serialization/parse-text.js";
export { stringifyText } from "./infra/serialization/stringify-text.js";
export { decode } from "./infra/serialization/decode.js";
export { encode, type EncodableSchema } from "./infra/serialization/encode.js";
export { ConfigDecodeError } from "./errors/config-decode-errors.js";
export type { ConfigDecodeErrorCode } from "./errors/config-decode-errors.js";
export { loadPromptBlocksFromYaml } from "./domain/prompt/load-prompt-blocks-from-yaml.js";
export type { AgentDefinition } from "./domain/agent/model/agent-definition.js";
export {
  agentDefinitionSchema,
  agentDefinitionDocumentSchema,
  promptsDocumentSchema,
} from "./domain/agent/agent-definition.schema.js";
export {
  validateAgentDefinition,
  type ValidateAgentDefinitionOptions,
} from "./domain/agent/validate-agent-definition.js";
export {
  resolveApplicationModelId,
  resolveSummaryApplicationModelId,
  type ResolveApplicationModelIdInput,
  type ResolveSummaryApplicationModelIdInput,
} from "./domain/agent/resolve-application-model-id.js";
export type { CompactionModelContext } from "./domain/compaction/compaction-model-context.js";
export type {
  CompactionPolicy,
  CompactionPolicyTemplate,
  CompactionTriggerConfig,
  CompactionActionConfig,
  CompactionAbstractConfig,
} from "./domain/compaction/compaction-policy.js";
export {
  compactionPolicySchema,
  compactionPolicyDocumentSchema,
  compactionPolicyTemplateSchema,
  compactionPolicyTemplateDocumentSchema,
} from "./domain/compaction/compaction-policy.schema.js";
export { CompactionPolicyError } from "./errors/compaction-policy-errors.js";
export type { CompactionPolicyErrorCode } from "./errors/compaction-policy-errors.js";
export type { CompactionPolicyStore } from "./service/compaction/compaction-policy-store.port.js";
export { createCompactionPolicyStore } from "./service/compaction/create-compaction-policy-store.js";
export type { CompactionAgentResolver } from "./service/compaction/compaction-agent-resolver.port.js";
export { createDbCompactionAgentResolver } from "./service/compaction/impl/db-compaction-agent-resolver.js";
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
export type { ModelSamplingProfile } from "./domain/provider/model/model-sampling-profile.js";
export {
  modelSamplingProfileFromJson,
  modelSamplingProfileToJson,
} from "./domain/provider/model/model-sampling-profile-from-json.js";
export type { ModelSamplingProfileService } from "./service/provider/model-sampling-profile.port.js";
export { createModelSamplingProfileService } from "./service/provider/create-model-sampling-profile-service.js";
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
} from "./domain/provider/application-model-id.js";
export type { LlmProvider } from "./domain/provider/model/provider.js";
export { providerApiKeyRef } from "./domain/provider/model/provider.js";
export type {
  LlmProtocolKind,
  LlmToolDefinition,
  LlmStreamEvent,
} from "./infra/llm-protocol/adapter.port.js";
export { toolsFromRegistry } from "./infra/llm-protocol/tool-definitions.js";
export { zodToJsonSchema } from "./infra/llm-protocol/zod-to-json-schema.js";
/** @internal CLI e2e fetch capture */
export {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "./infra/llm-protocol/registry.js";
export type { AgentSession } from "./domain/agent/session/agent-session.port.js";
export { AgentError } from "./domain/agent/agent-errors.js";
export type { AgentErrorCode } from "./domain/agent/agent-errors.js";
export type {
  AgentRunResult,
  ModelRoundSummary,
} from "./domain/agent/model/agent-run-result.js";
export { DOOM_LOOP_THRESHOLD, assertNoDoomLoopInBlocks } from "./domain/agent/doom-loop.js";
export { InMemoryAgentSession } from "./domain/agent/session/impl/in-memory-agent-session.js";
export { ChatAgentSession } from "./domain/agent/session/impl/chat-agent-session.js";
export type { AgentRunner, AgentRunOptions } from "./service/agent/agent.port.js";
export {
  createAgentRunner,
  createNoOpCompactionPipeline,
} from "./service/agent/create-agent-runner.js";
export type { CreateAgentRunnerDeps } from "./service/agent/create-agent-runner.js";
export type { CompactionPipeline } from "./service/compaction/compaction-pipeline.port.js";
export {
  createCompactionPipeline,
  type CreateCompactionPipelineDeps,
} from "./service/compaction/create-compaction-pipeline.js";
export { estimateTokens } from "./service/compaction/token-estimate.js";
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
export type { CompiledRegexRule } from "./domain/regex/compile-regex-rule.js";
export { compileRegexRule } from "./domain/regex/compile-regex-rule.js";
export {
  applyRegexRules,
  applyRegexToMessageContent,
  applyRegexChannelToMessages,
} from "./domain/regex/apply-regex-rules.js";
export type { RegexChannel } from "./domain/regex/apply-regex-rules.js";
export {
  listVisibleSorted,
  visibleFloorByMessageId,
} from "./domain/chat/message-visible-floor.js";
export { validateRegexRule, validateRegexRuleEntity } from "./domain/regex/validate-regex-rule.js";
export {
  createRegexRuleSchema,
  updateRegexRuleSchema,
  createRegexGroupSchema,
  updateRegexGroupSchema,
} from "./domain/regex/regex-rule.schema.js";
export type {
  CreateRegexRuleInput,
  UpdateRegexRuleInput,
  CreateRegexGroupInput,
  UpdateRegexGroupInput,
} from "./domain/regex/regex-rule.schema.js";
export { resolveActiveCompiledRules } from "./domain/regex/resolve-active-regex-rules.js";
export { createRegexConfigService } from "./service/regex/create-regex-config-service.js";
export type { RegexConfigService } from "./service/regex/regex-config.port.js";
