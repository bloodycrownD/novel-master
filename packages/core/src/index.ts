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
 * KKV module-scoped key-value store.
 */
export { KkvError } from "./errors/kkv-errors.js";
export type { KkvErrorCode } from "./errors/kkv-errors.js";
export { createKkvService } from "./service/kkv/create-kkv-service.js";
export type { KkvService } from "./service/kkv/kkv.port.js";

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
