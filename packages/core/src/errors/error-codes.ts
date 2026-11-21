/**
 * 全局错误码注册表。
 *
 * 采用 6 位十进制：前三位是域，后三位是域内序号（DDDSSS）。
 * 域号顺序分配：101 agent / 102 vfs / 103 character-card / 104 tool /
 * 105 provider / 106 chat / 107 skill / 108 compaction + smart-sort /
 * 109 config + preferences / 110 infra。后续域从 111 继续。
 *
 * 这样数字本身就能看出域：101001 = 域 101 + 序号 001，103001 = 域 103 + 序号 001。
 * 每域 1000 个码，共 1000 个域，总量 100 万；单域几百个码足够，域数量才是长期瓶颈。
 *
 * 新增码只能追加，数值不得复用或改号。
 *
 * 预分配段位（不建空 key，号段表 DOMAIN_RANGES 登记在 errors/domain.ts，test/errors/app-error.test.ts 引用同一份）：
 * 101 AGENT / 102 VFS（含 VFS_ZIP_*、VFS_CONTENT_*、VFS_SINGLE_FILE_*）/ 103 VFS_CHARACTER_CARD /
 * 104 TOOL / 105 PROVIDER / 106 CHAT / 107 SKILL / 108 COMPACTION_CONDITIONS 001-499 +
 * SMART_SORT_RULE 500-999 / 109 CONFIG 001-499 + PREFERENCES 500-999 / 110 INFRA /
 * 111 DEPTH / 112 EVENTS / 113 FEATURE_FLAGS / 114 FORMAT / 115 KKV /
 * 116 SESSION_FS / 117 PROMPT / 118 SESSION_KKV / 119 SESSION_RUN_STATE /
 * 120 USAGE / 121 WORKPLACE / 122 CLOUD_SYNC（三期 CloudSyncError 退役迁入）/
 * 123 IPC（TASK_CANCELLED / TASK_REPLACED 与 handler 直构码；控制流码 TOOL_CANCELLED 落 104 段）/
 * 124 CLI（apps/cli 子命令的用法提示与参数校验）/
 * 125 DB_BACKUP（十九期 ProviderTableSnapshot 14 个校验原因迁入，行号与表名走 params）。
 *
 * messageKey 是该码的缺省用户文案模板（i18n 契约 key，见 i18n/keys.ts 与
 * catalog/*.yaml，三处缺一即红）：descriptor 通道优先于它，动态诊断文案走
 * params.detail；中断/控制流码（TASK_CANCELLED / TASK_REPLACED）按总纲 §3.2
 * 不带 i18n key；`IPC_ABORTED` 例外——它是 IPC 边界的取消终态（renderer 据
 * code 静默收尾），messageKey 只作兜底文案。
 *
 * @module errors/error-codes
 */

import type { CoreMessageKey } from "@/i18n/keys.js";

/** 错误码定义表；新增码只能追加，数值不得复用或改号。 */
export interface ErrorCodeDef {
  readonly code: number;
  readonly desc: string;
  readonly messageKey?: CoreMessageKey;
}

/** 错误码注册表；每条 messageKey 须同步登记 i18n/keys.ts 与双 catalog。 */
export const ErrorCodes = {
  AGENT_DOOM_LOOP: {code: 101001, desc: "doom loop detected"},
  VFS_CHARACTER_CARD_UNRECOGNIZED: {code: 103001, desc: "not a character card", messageKey: "error.vfs.character_card_unrecognized"},
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: {code: 103002, desc: "unsupported character card spec", messageKey: "error.vfs.character_card_unsupported_spec"},
  VFS_CHARACTER_CARD_INVALID_PATH: {code: 103003, desc: "invalid character card path"},
  VFS_CHARACTER_CARD_NOT_CONFIRMED: {code: 103004, desc: "character card import not confirmed"},
  // 103 VFS_CHARACTER_CARD 005：导入失败已合入 VFS_IMPORT_FAILED（102030），码位不回收。
  VFS_CHARACTER_CARD_TOO_LARGE: {code: 103006, desc: "character card too large"},
  CHAT_INVALID_ARGUMENT: {code: 106001, desc: "invalid chat argument"},

  // 101 AGENT 002-999：agent schema / logic 的领域校验失败。
  AGENT_INVALID_SCHEMA: {code: 101002, desc: "invalid agent definition schema"},
  AGENT_INVALID_TOOL_POLICY: {code: 101003, desc: "invalid agent tool policy"},
  AGENT_INVALID_MODEL: {code: 101004, desc: "invalid or unsaved agent model"},
  AGENT_INVALID_COMPACT: {code: 101005, desc: "invalid agent compact policy"},
  AGENT_PROTOCOL_MISMATCH: {code: 101006, desc: "agent protocol mismatch"},
  AGENT_NOT_FOUND: {code: 101007, desc: "agent not found", messageKey: "error.agent.not_found"},
  AGENT_IN_USE: {code: 101008, desc: "agent in use"},
  AGENT_DUPLICATE_NAME: {code: 101009, desc: "duplicate agent name", messageKey: "error.agent.duplicate_name"},
  AGENT_BUILTIN_PROTECTED: {code: 101010, desc: "builtin agent protected"},
  // 101 AGENT 011-013：运行期控制（三期 handler 直构码迁入）。
  AGENT_RUN_FAILED: {code: 101011, desc: "agent run failed"},
  AGENT_BUSY: {code: 101012, desc: "agent busy"},
  AGENT_RUN_IN_FLIGHT: {code: 101013, desc: "agent run in flight"},
  // 101 AGENT 014-016：agent run resolve 失败（AgentRunResolveError 退役，messageKey 既有）。
  AGENT_NOT_CONFIGURED: {code: 101014, desc: "agent not configured", messageKey: "error.agent.not_configured"},
  AGENT_MODEL_NOT_SET: {code: 101015, desc: "agent model not set", messageKey: "error.agent.model_not_set"},
  AGENT_REFERENCED_NOT_FOUND: {code: 101016, desc: "session references a missing agent", messageKey: "error.agent.referenced_not_found"},
  // 101 AGENT 017：turn 前置的业务失败（AgentTurnError 退役迁入，messageKey 既有；无参数）。
  AGENT_MESSAGE_EMPTY: {code: 101017, desc: "agent turn message is empty", messageKey: "error.agent.message_empty"},

  // 102 VFS 001-999：vfs 路径、zip、content-store 与端口失败。
  VFS_NOT_FOUND: {code: 102001, desc: "vfs path or revision not found", messageKey: "error.vfs.not_found"},
  VFS_REPLACE_NOT_FOUND: {code: 102002, desc: "replace target string not found", messageKey: "error.vfs.replace_not_found"},
  VFS_DIRECTORY_NOT_EMPTY: {code: 102003, desc: "directory not empty"},
  VFS_INVALID_PATH: {code: 102004, desc: "invalid vfs path"},
  VFS_INVALID_NAME: {code: 102005, desc: "invalid vfs entry name"},
  VFS_IS_DIRECTORY: {code: 102006, desc: "path is a directory"},
  VFS_ALREADY_EXISTS: {code: 102007, desc: "path already exists", messageKey: "error.vfs.already_exists"},
  VFS_NOT_A_DIRECTORY: {code: 102008, desc: "path is not a directory"},
  VFS_PARENT_NOT_FOUND: {code: 102009, desc: "parent path not found"},
  VFS_INVALID_PATTERN: {code: 102010, desc: "invalid vfs grep pattern"},
  VFS_ZIP_INVALID_ARCHIVE: {code: 102011, desc: "invalid zip archive"},
  VFS_ZIP_INVALID_PATH: {code: 102012, desc: "invalid zip entry path"},
  VFS_ZIP_INVALID_UTF8: {code: 102013, desc: "invalid utf-8 zip entry name"},
  VFS_ZIP_DUPLICATE_PATH: {code: 102014, desc: "duplicate zip entry path"},
  VFS_ZIP_PAYLOAD_TOO_LARGE: {code: 102015, desc: "zip payload too large"},
  VFS_CONTENT_CORRUPT: {code: 102016, desc: "vfs content corrupt"},
  VFS_CONTENT_UNSUPPORTED_FORMAT: {code: 102017, desc: "unsupported vfs content format"},
  VFS_CONTENT_BLOB_MISSING: {code: 102018, desc: "vfs content blob missing"},
  // 102 VFS 020：不变量违规码已改 assert（common/assert.ts），码位不回收。
  VFS_RESTORE_FAILED: {code: 102021, desc: "vfs mutating path restore failed"},
  VFS_OPERATION_UNSUPPORTED: {code: 102022, desc: "vfs operation unsupported by this service"},
  VFS_ZIP_NOT_CONFIRMED: {code: 102023, desc: "zip import not confirmed", messageKey: "error.vfs.zip_not_confirmed"},
  VFS_ZIP_EXTERNAL_NOT_SUPPORTED: {code: 102024, desc: "external directory ingest unsupported", messageKey: "error.vfs.zip_external_not_supported"},
  // 102 VFS 025：导入失败已合入 VFS_IMPORT_FAILED（102030），码位不回收。
  // 102 VFS 026-029：mobile 单文件导入/导出（三期 VfsSingleFileError 退役预登记）。
  VFS_SINGLE_FILE_TOO_LARGE: {code: 102026, desc: "single-file import payload too large", messageKey: "error.vfs.single_file_too_large"},
  VFS_SINGLE_FILE_READ_FAILED: {code: 102027, desc: "single-file import read failed", messageKey: "error.vfs.single_file_read_failed"},
  VFS_SINGLE_FILE_NOT_FOUND: {code: 102028, desc: "picked file not found on disk", messageKey: "error.vfs.single_file_not_found"},
  VFS_SINGLE_FILE_EXPORT_TARGET_INVALID: {code: 102029, desc: "export target is not a single file", messageKey: "error.vfs.single_file_export_target_invalid"},
  // 102 VFS 030：zip 与角色卡导入失败的统一出口（原 VFS_ZIP_IMPORT_FAILED 102025 /
  // VFS_CHARACTER_CARD_IMPORT_FAILED 103005 已合入本码，码位不回收）。
  VFS_IMPORT_FAILED: {code: 102030, desc: "vfs import failed", messageKey: "error.vfs.import_failed"},

  // 104 TOOL 001-999：工具入参（phase 2 logic）、搜索配置/引擎失败与工具取消。
  TOOL_INVALID_ARGUMENT: {code: 104001, desc: "invalid tool argument"},
  TOOL_SEARCH_INVALID_ARGUMENT: {code: 104002, desc: "invalid search configuration argument"},
  TOOL_SEARCH_FAILED: {code: 104003, desc: "search engine request failed"},
  TOOL_SEARCH_TEMPLATE_INVALID: {code: 104004, desc: "invalid search engine template", messageKey: "error.tool.search_template_invalid"},
  TOOL_NOT_FOUND: {code: 104005, desc: "tool not registered", messageKey: "error.tool.not_found"},
  TOOL_FAILED: {code: 104007, desc: "tool execution failed", messageKey: "error.tool.failed"},
  TOOL_FORBIDDEN: {code: 104008, desc: "tool path outside allowed scope", messageKey: "error.tool.forbidden"},
  TOOL_CANCELLED: {code: 104009, desc: "tool execution cancelled", messageKey: "error.tool.cancelled"},

  // 105 PROVIDER 001-999：provider logic/model 的入参、模型 id 与密钥校验。
  PROVIDER_INVALID_ARGUMENT: {code: 105001, desc: "invalid provider argument"},
  PROVIDER_INVALID_SAVED_MODEL_ID: {code: 105002, desc: "invalid saved model id"},
  PROVIDER_API_KEY_NOT_SET: {code: 105003, desc: "provider api key not set", messageKey: "error.provider.api_key_not_set"},
  // 105 PROVIDER 004：不变量违规码已改 assert（common/assert.ts），码位不回收。
  PROVIDER_NOT_FOUND: {code: 105005, desc: "provider not found", messageKey: "error.provider.not_found"},
  PROVIDER_CONFLICT: {code: 105006, desc: "provider conflict", messageKey: "error.provider.conflict"},
  PROVIDER_BUILTIN_PROVIDER: {code: 105007, desc: "builtin provider protected", messageKey: "error.provider.builtin_provider"},
  PROVIDER_HTTP_ERROR: {code: 105008, desc: "provider http request failed", messageKey: "error.provider.http_error"},
  PROVIDER_MODEL_NOT_SAVED: {code: 105009, desc: "application model not saved", messageKey: "error.provider.model_not_saved"},
  PROVIDER_UNSUPPORTED_CONTENT: {code: 105010, desc: "unsupported provider content", messageKey: "error.provider.unsupported_content"},
  PROVIDER_UNSUPPORTED: {code: 105011, desc: "provider operation unsupported", messageKey: "error.provider.unsupported"},
  PROVIDER_MALFORMED_SSE: {code: 105012, desc: "malformed provider sse stream", messageKey: "error.provider.malformed_sse"},
  PROVIDER_INVALID_TOOL_ARGUMENTS: {code: 105013, desc: "invalid provider tool arguments", messageKey: "error.provider.invalid_tool_arguments"},
  PROVIDER_MIGRATION_ORPHAN_POINTER: {code: 105014, desc: "migration left an orphan pointer", messageKey: "error.provider.migration_orphan_pointer"},
  PROVIDER_SAVED_MODEL_IN_USE: {code: 105015, desc: "saved model in use", messageKey: "error.provider.saved_model_in_use"},
  PROVIDER_INVALID_MODEL_NAME: {code: 105016, desc: "invalid provider model name", messageKey: "error.provider.invalid_model_name"},
  // 105 PROVIDER 017：handler 直构码（三期迁入）。
  PROVIDER_MODEL_MISMATCH: {code: 105017, desc: "provider model mismatch"},
  // 105 PROVIDER 018：LLM 流式整调用超时（LlmStreamTimeoutError 退役；phase/timeoutMs 走 params，message 用 detail 承载原动态文案）。
  PROVIDER_STREAM_TIMEOUT: {code: 105018, desc: "provider stream timeout"},

  // 106 CHAT 002-999：消息行/元数据损坏（001 为历史保留）。
  CHAT_MESSAGE_CORRUPT: {code: 106002, desc: "chat message row corrupt"},
  CHAT_NOT_FOUND: {code: 106003, desc: "chat entity not found", messageKey: "error.chat.not_found"},
  CHAT_CONFLICT: {code: 106004, desc: "chat conflict"},

  // 107 SKILL 001-999：技能名、域参数、路径与内置保护。
  SKILL_INVALID_NAME: {code: 107001, desc: "invalid skill name"},
  SKILL_MISSING_DOMAIN: {code: 107002, desc: "skill domain missing", messageKey: "error.skill.missing_domain"},
  SKILL_MISSING_PROJECT_ID: {code: 107003, desc: "skill project id missing", messageKey: "error.skill.missing_project_id"},
  SKILL_INVALID_PATH: {code: 107004, desc: "invalid skill path"},
  SKILL_NOT_FOUND: {code: 107005, desc: "skill not found", messageKey: "error.skill.not_found"},
  SKILL_BUILTIN: {code: 107006, desc: "builtin skill protected", messageKey: "error.skill.builtin_not_deletable"},
  SKILL_BUILTIN_NAME_RESERVED: {code: 107007, desc: "builtin skill name reserved", messageKey: "error.skill.builtin_name_reserved"},
  SKILL_BUILTIN_RENAME: {code: 107008, desc: "builtin skill rename rejected", messageKey: "error.skill.builtin_rename_forbidden"},
  SKILL_ALREADY_EXISTS: {code: 107009, desc: "skill already exists", messageKey: "error.skill.already_exists"},

  // 108 COMPACTION_CONDITIONS 001-499 + SMART_SORT_RULE 500-999。
  COMPACTION_CONDITIONS_INVALID_SCHEMA: {code: 108001, desc: "invalid compaction conditions schema"},
  COMPACTION_CONDITIONS_NOT_FOUND: {code: 108002, desc: "compaction conditions not found"},
  SMART_SORT_RULE_INVALID_ARGUMENT: {code: 108500, desc: "invalid smart sort rule argument"},
  SMART_SORT_RULE_INVALID_PATTERN: {code: 108501, desc: "invalid smart sort rule pattern"},
  SMART_SORT_RULE_NOT_FOUND: {code: 108502, desc: "smart sort rule not found"},
  SMART_SORT_RULE_CONFLICT: {code: 108503, desc: "smart sort rule conflict"},
  SMART_SORT_RULE_BUILTIN_PROTECTED: {code: 108504, desc: "builtin smart sort rule protected"},

  // 109 CONFIG 001-499 + PREFERENCES 500-999。
  CONFIG_DECODE_INVALID_SCHEMA: {code: 109001, desc: "config data does not match its schema", messageKey: "error.infra.decode_invalid_schema"},
  CONFIG_DECODE_ENCODE_NOT_SUPPORTED: {code: 109002, desc: "encoding not supported for this format", messageKey: "error.infra.encode_not_supported"},
  PREFERENCES_INVALID_VALUE: {code: 109500, desc: "invalid preference value"},

  // 110 INFRA 001-999：组合根启动前置条件与平台能力检查。
  INFRA_BASELINE_TOO_OLD: {code: 110001, desc: "database baseline too old"},
  INFRA_UNSUPPORTED_PLATFORM: {code: 110002, desc: "unsupported platform for sksp driver"},
  // 110 INFRA 003：不变量违规码已改 assert（common/assert.ts），码位不回收。
  // 110 INFRA 004-005：IPC 边界兜底（三期迁入；message 是边界格式化的动态文案，不配模板）。
  INFRA_VALIDATION_FAILED: {code: 110004, desc: "request validation failed"},
  INFRA_UNEXPECTED_ERROR: {code: 110005, desc: "unexpected internal error"},
  INFRA_ROLLBACK_DEGRADED: {code: 110006, desc: "coordinated write rollback partially failed", messageKey: "error.infra.rollback_degraded"},

  // 114 FORMAT 001-999：外部 wire 版本串格式校验。
  FORMAT_INVALID_VERSION: {code: 114001, desc: "invalid version string"},

  // 115 KKV 001-999。
  KKV_NOT_FOUND: {code: 115001, desc: "kkv key not found"},
  KKV_CONFLICT: {code: 115002, desc: "kkv conflict"},

  // 111 DEPTH 001-999。
  DEPTH_INVALID_SLICE: {code: 111001, desc: "invalid depth slice"},

  // 116 SESSION_FS 001-999。
  SESSION_FS_RESTORE_REVISION_MISSING: {code: 116001, desc: "restore revision missing", messageKey: "error.session_fs.restore_revision_missing"},
  SESSION_FS_INVALID_ROLLBACK_OPTIONS: {code: 116002, desc: "invalid rollback option combination", messageKey: "error.session_fs.invalid_rollback_options"},
  SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND: {code: 116003, desc: "rollback message not found", messageKey: "error.session_fs.rollback_message_not_found"},
  SESSION_FS_ROLLBACK_MESSAGE_SESSION_MISMATCH: {code: 116004, desc: "rollback message session mismatch", messageKey: "error.session_fs.rollback_message_session_mismatch"},
  SESSION_FS_ROLLBACK_NO_CHECKPOINT: {code: 116005, desc: "rollback checkpoint missing", messageKey: "error.session_fs.rollback_no_checkpoint"},
  SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED: {code: 116006, desc: "rollback vfs restore failed", messageKey: "error.session_fs.vfs_restore_failed"},
  SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED: {code: 116007, desc: "rollback revision backfill required", messageKey: "error.session_fs.rollback_revision_backfill_required"},
  SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET: {code: 116008, desc: "rollback undo_send empty target"},
  SESSION_FS_ROLLBACK_CONFLICT: {code: 116009, desc: "rollback optimistic-lock conflict", messageKey: "error.session_fs.rollback_conflict"},
  SESSION_FS_ROLLBACK_TAIL_DRIFT: {code: 116010, desc: "rollback tail drift", messageKey: "error.session_fs.rollback_tail_drift"},

  // 117 PROMPT 001-999：布局校验与动态宏校验。
  PROMPT_INVALID_LAYOUT: {code: 117001, desc: "invalid prompt layout"},
  PROMPT_INVALID_MACRO: {code: 117002, desc: "invalid prompt macro"},
  // 117 PROMPT 003：不变量违规码已改 assert（common/assert.ts），码位不回收。
  PROMPT_INVALID_YAML: {code: 117004, desc: "invalid prompt yaml", messageKey: "error.prompt.invalid_yaml"},
  PROMPT_INVALID_BLOCK: {code: 117005, desc: "invalid prompt block", messageKey: "error.prompt.invalid_block"},
  PROMPT_UNKNOWN_FIELD: {code: 117006, desc: "unknown prompt field", messageKey: "error.prompt.unknown_field"},
  PROMPT_UNSUPPORTED_SYNTAX: {code: 117007, desc: "unsupported prompt syntax", messageKey: "error.prompt.unsupported_syntax"},

  // 121 WORKPLACE 001-999：工作区规则、缓存载荷与物化失败。
  WORKPLACE_INVALID_RULE_SNAPSHOT: {code: 121001, desc: "invalid workplace rule snapshot"},
  WORKPLACE_INVALID_FILE_CACHE: {code: 121002, desc: "invalid workplace file cache payload"},
  WORKPLACE_MATERIALIZE_FAILED: {code: 121003, desc: "workplace materialize failed"},
  WORKPLACE_INVALID_RULE_ROW: {code: 121004, desc: "invalid workplace rule row"},
  WORKPLACE_ROOT_RULE_LOCKED: {code: 121005, desc: "root directory rules cannot be disabled"},

  // 122 CLOUD_SYNC 001-999：云同步协调器与 S3 驱动（三期 CloudSyncError 退役迁入，枚举序号即迁移顺序）。
  CLOUD_SYNC_NOT_CONFIGURED: {code: 122001, desc: "cloud sync not configured", messageKey: "error.cloud_sync.not_configured"},
  CLOUD_SYNC_NEED_PULL_FIRST: {code: 122002, desc: "remote is ahead; pull first"},
  CLOUD_SYNC_LOCK_HELD_BY_OTHER: {code: 122003, desc: "cloud sync lock held by another device", messageKey: "error.cloud_sync.lock_held_by_other"},
  CLOUD_SYNC_LOCK_CONTENTION: {code: 122004, desc: "cloud sync lock contention", messageKey: "error.cloud_sync.lock_contention"},
  CLOUD_SYNC_AGENT_ACTIVE: {code: 122005, desc: "agent active during cloud sync"},
  CLOUD_SYNC_PUSH_MUTEX_TIMEOUT: {code: 122006, desc: "push/agent mutex acquire timed out"},
  CLOUD_SYNC_ALREADY_UP_TO_DATE: {code: 122007, desc: "local already up to date", messageKey: "error.cloud_sync.already_up_to_date"},
  CLOUD_SYNC_INVALID_STATUS: {code: 122008, desc: "remote status.json invalid"},
  CLOUD_SYNC_SNAPSHOT_MISSING: {code: 122009, desc: "remote snapshot missing", messageKey: "error.cloud_sync.snapshot_missing"},
  CLOUD_SYNC_CHECKSUM_MISMATCH: {code: 122010, desc: "downloaded snapshot checksum mismatch", messageKey: "error.cloud_sync.download_checksum_mismatch"},
  CLOUD_SYNC_NETWORK: {code: 122011, desc: "cloud storage network error"},
  CLOUD_SYNC_AUTH: {code: 122012, desc: "cloud storage auth error"},

  // 123 IPC 001-999：跨进程控制流码（总纲 §四：cancelled/replaced 平级，不算用户可见错误）
  // 与 handler 直构码（003-006 三期迁入）。
  TASK_CANCELLED: {code: 123001, desc: "task cancelled"},
  TASK_REPLACED: {code: 123002, desc: "task replaced by a newer run"},
  IPC_INVALID_URL: {code: 123003, desc: "invalid external url"},
  IPC_INVALID_MENU: {code: 123004, desc: "unknown menu id"},
  IPC_NO_WINDOW: {code: 123005, desc: "no available window"},
  IPC_INVALID_ARGUMENT: {code: 123006, desc: "invalid ipc argument"},
  // 123 IPC 007-009：取消链路（signal-abort-scope §五）。IPC_ABORTED 是取消终态，
  // 供 IpcErrorPayload.code 与 renderer 静默收尾；PROVIDER_MODELS_IN_FLIGHT 虽按
  // provider 命名，但按 spec 落 123 段（handler 级并发冲突，不是 provider 业务失败）。
  IPC_ABORTED: {code: 123007, desc: "operation aborted", messageKey: "error.infra.aborted"},
  IPC_INVALID_ABORT_TARGET: {code: 123008, desc: "unknown abort target kind", messageKey: "error.infra.invalid_abort_target"},
  PROVIDER_MODELS_IN_FLIGHT: {code: 123009, desc: "provider models fetch already in flight", messageKey: "error.provider.models_in_flight"},

  // 124 CLI 001-999：apps/cli 子命令的用法提示与参数校验（九期裸 throw 收敛）。文案随
  // params.detail 走、不配 messageKey——cli 出口按 message 的 "Usage:" 前缀判 EXIT_USAGE，
  // 配模板会把 message 换成翻译文案，断掉该既有约定。
  CLI_INVALID_ARGUMENT: {code: 124001, desc: "invalid cli argument"},

  // 125 DB_BACKUP 001-999：provider 三表快照校验（十九期快照校验错误类退役迁入，
  // 14 个构造点的 descriptor 一一对应；定位信息 row_index / table 等走 params）。
  DB_BACKUP_PROVIDER_ROW_ID_MISSING: {code: 125001, desc: "provider row id missing", messageKey: "error.db_backup.provider_row_id_missing"},
  DB_BACKUP_PROVIDER_ROW_PROTOCOL_INVALID: {code: 125002, desc: "provider row protocol invalid", messageKey: "error.db_backup.provider_row_protocol_invalid"},
  DB_BACKUP_PROVIDER_ROW_BASE_URL_EMPTY: {code: 125003, desc: "provider row base url empty", messageKey: "error.db_backup.provider_row_base_url_empty"},
  DB_BACKUP_PROVIDER_ROW_DISPLAY_NAME_EMPTY: {code: 125004, desc: "provider row display name empty", messageKey: "error.db_backup.provider_row_display_name_empty"},
  DB_BACKUP_PROVIDER_ROW_IS_BUILTIN_NOT_NUMBER: {code: 125005, desc: "provider row is_builtin is not a number", messageKey: "error.db_backup.provider_row_is_builtin_not_number"},
  DB_BACKUP_PROVIDER_ROW_TIMESTAMP_INVALID: {code: 125006, desc: "provider row timestamp missing or not a number", messageKey: "error.db_backup.provider_row_timestamp_invalid"},
  DB_BACKUP_SAVED_MODEL_ROW_PROVIDER_ID_EMPTY: {code: 125007, desc: "saved model row provider id empty", messageKey: "error.db_backup.saved_model_row_provider_id_empty"},
  DB_BACKUP_SAVED_MODEL_ROW_VENDOR_MODEL_ID_EMPTY: {code: 125008, desc: "saved model row vendor model id empty", messageKey: "error.db_backup.saved_model_row_vendor_model_id_empty"},
  DB_BACKUP_SAVED_MODEL_ROW_SETTINGS_JSON_MISSING: {code: 125009, desc: "saved model row settings json missing", messageKey: "error.db_backup.saved_model_row_settings_json_missing"},
  DB_BACKUP_DANGLING_SAVED_MODEL: {code: 125010, desc: "saved model row references a missing provider", messageKey: "error.db_backup.dangling_saved_model"},
  DB_BACKUP_SECRET_ROW_REF_MISSING: {code: 125011, desc: "secret row ref missing", messageKey: "error.db_backup.secret_row_ref_missing"},
  DB_BACKUP_SECRET_ROW_CIPHERTEXT_MISSING: {code: 125012, desc: "secret row ciphertext missing", messageKey: "error.db_backup.secret_row_ciphertext_missing"},
  DB_BACKUP_SECRET_ROW_ALGO_EMPTY: {code: 125013, desc: "secret row algo empty", messageKey: "error.db_backup.secret_row_algo_empty"},
  DB_BACKUP_SECRET_ROW_VERSION_NOT_NUMBER: {code: 125014, desc: "secret row version is not a number", messageKey: "error.db_backup.secret_row_version_not_number"},
  // 库已换代但收尾（服务商三表恢复）失败：不回滚、调用方须重建 runtime——
  // DatabaseReplacedError 异常哨兵退役（error-matrix-final R2）改走此码。
  DB_BACKUP_REPLACE_INCOMPLETE: {code: 125015, desc: "database replaced but provider tables restore failed", messageKey: "error.db_backup.replace_incomplete"},
} as const satisfies Record<string, ErrorCodeDef>;

export type ErrorKey = keyof typeof ErrorCodes;
export type ErrorNumber = (typeof ErrorCodes)[ErrorKey]["code"];
