/**
 * JSON 文本解析。
 *
 * @module common/json
 */

import { Result } from "@/errors/either.js";

/**
 * 解析 JSON 文本（剥离 UTF-8 BOM）；失败返回 Err<Error>，不抛。
 */
export function parseJsonText(text: string): Result<unknown, Error> {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return Result.ok(JSON.parse(stripped) as unknown);
  } catch (error) {
    return Result.err(error instanceof Error ? error : new Error(String(error)));
  }
}
