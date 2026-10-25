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
} as const satisfies Record<string, {readonly code: number; readonly desc: string}>;

export type ErrorKey = keyof typeof ErrorCodes;
export type ErrorNumber = (typeof ErrorCodes)[ErrorKey]["code"];
