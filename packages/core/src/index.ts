export const PACKAGE_NAME = "@novel-master/core";

/**
 * MyBatis 风格动态 SQL 模板解析（`#{...}` 与 `${...}`）。
 *
 * @remarks
 * `${name}` 会以原始字符串内联到 SQL，调用方必须自行做白名单或校验，避免注入风险。
 */
export {
  SqlTemplateParser,
  SqlTemplateError,
  parseTemplateToAst,
  normalizeExpression,
  bindExpressionToContext,
  evaluateTest,
} from "./infra/sql-template/index.js";
export type {
  EvaluateTestOptions,
  SqlParseResult,
  ParseOptions,
  SqlTemplateErrorCode,
  AstNode,
} from "./infra/sql-template/index.js";

/**
 * TDBC：异步 SQLite 连接协议（驱动由调用方独立注册）。
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
 * 启动与迁移：Novel Master 运行时基础建表。
 */
export {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
} from "./bootstrap/novel-master-bootstrap.js";

/**
 * 数据备份：导出时清除、导入时保留 provider 三表。
 */
export {
  DB_BACKUP_PROVIDER_TABLES,
  dumpProviderTableSnapshot,
  scrubProviderTables,
  scrubProviderTablesInDatabase,
  restoreProviderTableSnapshot,
} from "./infra/db-backup/index.js";
export type {
  ProviderBackupTableName,
  ProviderTableSnapshot,
} from "./infra/db-backup/index.js";

/**
 * 跨端云同步：协调器、租约锁与 status schema。
 */
export {
  CloudSyncError,
  isCloudSyncError,
  CloudSyncCoordinator,
  parseCloudSyncStatus,
  EMPTY_CLOUD_SYNC_STATUS,
  isEffectiveLock,
  canAcquireLock,
  buildLease,
  renewLease,
  DEFAULT_LEASE_SECONDS,
  normalizePrefix,
  statusKey,
  snapshotKey,
} from "./infra/cloud-sync/index.js";
export type {
  CloudSyncErrorCode,
  ObjectStorageHeadResult,
  ObjectStoragePort,
  DbSyncPort,
  CloudSyncLock,
  CloudSyncStatus,
  CloudSyncCoordinatorDeps,
  PullOptions,
  PullResult,
  PushOptions,
  PushResult,
} from "./infra/cloud-sync/index.js";

/**
 * 偏好与持久状态：对 KKV 的稳定封装（非 UI 模块直连 KKV）。
 */
export { KkvError, isKkvError } from "./errors/kkv-errors.js";
export type { KkvErrorCode } from "./errors/kkv-errors.js";
export { PreferencesError } from "./errors/preferences-errors.js";
export type { PreferencesErrorCode } from "./errors/preferences-errors.js";
export { createPersistentState } from "./service/persistent-state/create-persistent-state.js";
export type { PersistentState } from "./service/persistent-state/persistent-state.port.js";
export { createPersistentPreferences } from "./service/persistent-preferences/create-persistent-preferences.js";
export type { PersistentPreferences } from "./service/persistent-preferences/persistent-preferences.port.js";
export {
  PREFERENCES_MODULE,
  PREF_KEY_SESSION_FS_VERSION_CHECK,
  PREF_KEY_CHAT_LLM_STREAM,
} from "./service/persistent-preferences/impl/preference-keys.js";
export {
  WORKSPACE_STATE_MODULE,
  KEY_CURRENT_PROJECT_ID,
  KEY_CURRENT_SESSION_ID,
  KEY_CURRENT_PROVIDER_ID,
  KEY_CURRENT_MODEL_ID,
  KEY_CURRENT_REGEX_GROUP_ID,
  KEY_CURRENT_AGENT_ID,
} from "./service/persistent-state/impl/workspace-state-keys.js";
/**
 * Tool 运行时：注册表、执行器与内置 `vfs.*` 工具。
 */
export type { Tool } from "./domain/tool/model/tool.js";
export { ToolError } from "./errors/tool-errors.js";
export type { ToolErrorCode } from "./errors/tool-errors.js";
export { ToolRegistry } from "./domain/tool/logic/tool-registry.js";
export { ToolRunner } from "./domain/tool/logic/tool-runner.js";
export type {
  ToolCall,
  ParallelToolOutcome,
} from "./domain/tool/logic/tool-runner.js";
export {
  buildToolResultBlock,
  resolveToolResultOk,
} from "./domain/tool/logic/build-tool-result-block.js";
export type { BuildToolResultBlockMeta } from "./domain/tool/logic/build-tool-result-block.js";
export {
  createVfsTools,
  FILE_TOOL_NAMES,
  FILE_OPEN_TOOL_NAMES,
  MUTATING_FILE_TOOL_NAMES,
  isMutatingFileToolName,
  MUTATING_VFS_TOOL_NAMES,
  isMutatingVfsToolName,
} from "./domain/tool/builtin/vfs-tools.js";
export {
  registerBuiltinTools,
  registerVfsTools,
} from "./domain/tool/builtin/register-builtin-tools.js";
export { isMutatingFsCommand } from "./domain/tool/logic/fs-command.js";
export {
  toolUseMutatesWorkspace,
  anyToolUseMutatesWorkspace,
} from "./domain/tool/logic/tool-use-mutates-workspace.js";
export {
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_MAX_LINE_LENGTH,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_MATCHES,
} from "./domain/tool/logic/tool-output-limits.js";
export type { FileToolName } from "./domain/tool/builtin/vfs-tools.js";
export type {
  BuiltinToolContext,
  VfsToolContext,
} from "./domain/tool/builtin/builtin-tool-context.js";

/**
 * 基础序列化能力：供跨端配置读写共用。
 */
export { parseText, type TextFormat } from "./infra/serialization/parse-text.js";
export { stringifyText } from "./infra/serialization/stringify-text.js";
export { decode } from "./infra/serialization/decode.js";
export { encode, type EncodableSchema } from "./infra/serialization/encode.js";
export { ConfigDecodeError } from "./errors/config-decode-errors.js";
export type { ConfigDecodeErrorCode } from "./errors/config-decode-errors.js";

