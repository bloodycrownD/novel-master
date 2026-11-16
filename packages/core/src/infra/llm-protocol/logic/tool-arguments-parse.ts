/**
 * tool call 参数字符串的 JSON 解析（finish 路径严格校验）。
 *
 * @module infra/llm-protocol/logic/tool-arguments-parse
 */

export type TryParseToolArgumentsResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly raw: string };

/** finish 路径：非法 JSON 返回 `{ ok: false, raw }`，不抛错。 */
export function tryParseToolArgumentsJson(
  raw: string
): TryParseToolArgumentsResult {
  if (raw === "") {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { ok: false, raw };
  }
}

