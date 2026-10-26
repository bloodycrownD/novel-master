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
 * 预分配段位（不建空 key，登记在 test/errors/app-error.test.ts 的 DOMAIN_RANGES）：
 * 101 AGENT / 102 VFS（含 VFS_ZIP_*、VFS_CONTENT_*）/ 103 VFS_CHARACTER_CARD /
 * 104 TOOL / 105 PROVIDER / 106 CHAT / 107 SKILL / 108 COMPACTION_CONDITIONS 001-499 +
 * SMART_SORT_RULE 500-999 / 109 CONFIG 001-499 + PREFERENCES 500-999 / 110 INFRA /
 * 111 DEPTH / 112 EVENTS / 113 FEATURE_FLAGS / 114 FORMAT / 115 KKV /
 * 116 SESSION_FS / 117 PROMPT / 118 SESSION_KKV / 119 SESSION_RUN_STATE /
 * 120 USAGE / 121 WORKPLACE。
 *
 * @module errors/error-codes
 */

/** 错误码定义表；新增码只能追加，数值不得复用或改号。 */
export const ErrorCodes = {
  AGENT_DOOM_LOOP: {code: 101001, desc: "doom loop detected"},
  VFS_CHARACTER_CARD_UNRECOGNIZED: {code: 103001, desc: "not a character card"},
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: {code: 103002, desc: "unsupported character card spec"},
  VFS_CHARACTER_CARD_INVALID_PATH: {code: 103003, desc: "invalid character card path"},
  VFS_CHARACTER_CARD_NOT_CONFIRMED: {code: 103004, desc: "character card import not confirmed"},
  VFS_CHARACTER_CARD_IMPORT_FAILED: {code: 103005, desc: "character card import failed"},
  VFS_CHARACTER_CARD_TOO_LARGE: {code: 103006, desc: "character card too large"},
  CHAT_INVALID_ARGUMENT: {code: 106001, desc: "invalid chat argument"},

  // 101 AGENT 002-999：agent schema / logic 的领域校验失败。
  AGENT_INVALID_SCHEMA: {code: 101002, desc: "invalid agent definition schema"},
  AGENT_INVALID_TOOL_POLICY: {code: 101003, desc: "invalid agent tool policy"},
  AGENT_INVALID_MODEL: {code: 101004, desc: "invalid or unsaved agent model"},
  AGENT_INVALID_COMPACT: {code: 101005, desc: "invalid agent compact policy"},
  AGENT_PROTOCOL_MISMATCH: {code: 101006, desc: "agent protocol mismatch"},
  AGENT_NOT_FOUND: {code: 101007, desc: "agent not found"},
  AGENT_IN_USE: {code: 101008, desc: "agent in use"},
  AGENT_DUPLICATE_NAME: {code: 101009, desc: "duplicate agent name"},

  // 102 VFS 001-999：vfs 路径、zip、content-store 与端口失败。
  VFS_NOT_FOUND: {code: 102001, desc: "vfs path or revision not found"},
  VFS_REPLACE_NOT_FOUND: {code: 102002, desc: "replace target string not found"},
  VFS_DIRECTORY_NOT_EMPTY: {code: 102003, desc: "directory not empty"},
  VFS_INVALID_PATH: {code: 102004, desc: "invalid vfs path"},
  VFS_INVALID_NAME: {code: 102005, desc: "invalid vfs entry name"},
  VFS_IS_DIRECTORY: {code: 102006, desc: "path is a directory"},
  VFS_ALREADY_EXISTS: {code: 102007, desc: "path already exists"},
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
  VFS_INVARIANT_VIOLATION: {code: 102020, desc: "vfs invariant violation"},
  VFS_RESTORE_FAILED: {code: 102021, desc: "vfs mutating path restore failed"},

  // 104 TOOL 001-999：工具入参（phase 2 logic）与搜索配置/引擎失败。
  TOOL_INVALID_ARGUMENT: {code: 104001, desc: "invalid tool argument"},
  TOOL_SEARCH_INVALID_ARGUMENT: {code: 104002, desc: "invalid search configuration argument"},
  TOOL_SEARCH_FAILED: {code: 104003, desc: "search engine request failed"},

  // 105 PROVIDER 001-999：provider logic/model 的入参、模型 id 与密钥校验。
  PROVIDER_INVALID_ARGUMENT: {code: 105001, desc: "invalid provider argument"},
  PROVIDER_INVALID_SAVED_MODEL_ID: {code: 105002, desc: "invalid saved model id"},
  PROVIDER_API_KEY_NOT_SET: {code: 105003, desc: "provider api key not set"},
  PROVIDER_INVARIANT_VIOLATION: {code: 105004, desc: "provider invariant violation"},

  // 106 CHAT 002-999：消息行/元数据损坏（001 为历史保留）。
  CHAT_MESSAGE_CORRUPT: {code: 106002, desc: "chat message row corrupt"},
  CHAT_NOT_FOUND: {code: 106003, desc: "chat entity not found"},
  CHAT_CONFLICT: {code: 106004, desc: "chat conflict"},

  // 107 SKILL 001-999：技能名、域参数、路径与内置保护。
  SKILL_INVALID_NAME: {code: 107001, desc: "invalid skill name"},
  SKILL_MISSING_DOMAIN: {code: 107002, desc: "skill domain missing"},
  SKILL_MISSING_PROJECT_ID: {code: 107003, desc: "skill project id missing"},
  SKILL_INVALID_PATH: {code: 107004, desc: "invalid skill path"},
  SKILL_NOT_FOUND: {code: 107005, desc: "skill not found"},
  SKILL_BUILTIN: {code: 107006, desc: "builtin skill protected"},
  SKILL_BUILTIN_NAME_RESERVED: {code: 107007, desc: "builtin skill name reserved"},
  SKILL_BUILTIN_RENAME: {code: 107008, desc: "builtin skill rename rejected"},
  SKILL_ALREADY_EXISTS: {code: 107009, desc: "skill already exists"},

  // 108 COMPACTION_CONDITIONS 001-499 + SMART_SORT_RULE 500-999。
  COMPACTION_CONDITIONS_INVALID_SCHEMA: {code: 108001, desc: "invalid compaction conditions schema"},
  COMPACTION_CONDITIONS_NOT_FOUND: {code: 108002, desc: "compaction conditions not found"},
  SMART_SORT_RULE_INVALID_ARGUMENT: {code: 108500, desc: "invalid smart sort rule argument"},
  SMART_SORT_RULE_INVALID_PATTERN: {code: 108501, desc: "invalid smart sort rule pattern"},
  SMART_SORT_RULE_NOT_FOUND: {code: 108502, desc: "smart sort rule not found"},
  SMART_SORT_RULE_CONFLICT: {code: 108503, desc: "smart sort rule conflict"},
  SMART_SORT_RULE_BUILTIN_PROTECTED: {code: 108504, desc: "builtin smart sort rule protected"},

  // 109 CONFIG 001-499 + PREFERENCES 500-999。
  PREFERENCES_INVALID_VALUE: {code: 109500, desc: "invalid preference value"},

  // 115 KKV 001-999。
  KKV_NOT_FOUND: {code: 115001, desc: "kkv key not found"},
  KKV_CONFLICT: {code: 115002, desc: "kkv conflict"},

  // 111 DEPTH 001-999。
  DEPTH_INVALID_SLICE: {code: 111001, desc: "invalid depth slice"},

  // 116 SESSION_FS 001-999。
  SESSION_FS_RESTORE_REVISION_MISSING: {code: 116001, desc: "restore revision missing"},

  // 117 PROMPT 001-999：布局校验与动态宏校验。
  PROMPT_INVALID_LAYOUT: {code: 117001, desc: "invalid prompt layout"},
  PROMPT_INVALID_MACRO: {code: 117002, desc: "invalid prompt macro"},
  PROMPT_INVARIANT_VIOLATION: {code: 117003, desc: "prompt normalization invariant violation"},

  // 121 WORKPLACE 001-999：工作区规则、缓存载荷与物化失败。
  WORKPLACE_INVALID_RULE_SNAPSHOT: {code: 121001, desc: "invalid workplace rule snapshot"},
  WORKPLACE_INVALID_FILE_CACHE: {code: 121002, desc: "invalid workplace file cache payload"},
  WORKPLACE_MATERIALIZE_FAILED: {code: 121003, desc: "workplace materialize failed"},
  WORKPLACE_INVALID_RULE_ROW: {code: 121004, desc: "invalid workplace rule row"},
} as const satisfies Record<string, {readonly code: number; readonly desc: string}>;

export type ErrorKey = keyof typeof ErrorCodes;
export type ErrorNumber = (typeof ErrorCodes)[ErrorKey]["code"];
