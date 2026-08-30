/**
 * 角色卡解析与导入错误。
 *
 * @module errors/character-card-errors
 */

/** {@link CharacterCardError} 的判别码（勿另造旁路代号）。 */
export type CharacterCardErrorCode =
  | "NOT_CHARACTER_CARD"
  | "UNSUPPORTED_SPEC"
  | "INVALID_PATH"
  | "NOT_CONFIRMED"
  | "IMPORT_FAILED";

/**
 * 角色卡解析、路径校验与导入编排的统一错误。
 */
export class CharacterCardError extends Error {
  readonly code: CharacterCardErrorCode;

  constructor(code: CharacterCardErrorCode, message: string) {
    super(message);
    this.name = "CharacterCardError";
    this.code = code;
  }
}

/** 构造 {@link CharacterCardError}。 */
export function characterCardError(
  code: CharacterCardErrorCode,
  message: string
): CharacterCardError {
  return new CharacterCardError(code, message);
}
