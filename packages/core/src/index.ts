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
 * KKV module-scoped key-value store.
 */
export { KkvError } from "./errors/kkv-errors.js";
export type { KkvErrorCode } from "./errors/kkv-errors.js";
export { createKkvService } from "./service/kkv/create-kkv-service.js";
export type { KkvService } from "./service/kkv/kkv.port.js";

/**
 * Config: application-level global configuration.
 */
export { ConfigError } from "./errors/config-errors.js";
export type { ConfigErrorCode } from "./errors/config-errors.js";
export { createConfigService } from "./service/config/create-config-service.js";
export type { ConfigService } from "./service/config/config.port.js";

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
export { validatePromptBlocks } from "./domain/prompt/prompt-blocks-validate.js";
export { parsePromptYaml } from "./infra/prompt-yaml/parse-prompt-yaml.js";
export {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
} from "./service/prompt/render-prompt.js";
export type {
  PromptRenderContext,
  PromptLlmInput,
} from "./service/prompt/render-prompt.js";
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
export type { AgentSession } from "./domain/agent/agent-session.port.js";
export { AgentError } from "./domain/agent/agent-errors.js";
export type { AgentErrorCode } from "./domain/agent/agent-errors.js";
export type {
  AgentRunResult,
  ModelRoundSummary,
} from "./domain/agent/agent-run-result.js";
export { DOOM_LOOP_THRESHOLD, assertNoDoomLoopInBlocks } from "./domain/agent/doom-loop.js";
export { InMemoryAgentSession } from "./domain/agent/impl/in-memory-agent-session.js";
export { ChatAgentSession } from "./domain/agent/impl/chat-agent-session.js";
export type { AgentRunner, AgentRunOptions } from "./service/agent/agent.port.js";
export { createAgentRunner } from "./service/agent/create-agent-runner.js";
export type { CreateAgentRunnerDeps } from "./service/agent/create-agent-runner.js";
export type { CompactionService } from "./service/compaction/compaction.port.js";
export {
  DefaultCompactionService,
  NoOpCompactionService,
} from "./service/compaction/impl/default-compaction.service.js";
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
