/**
 * tool call 参数字符串的 JSON 解析（finish 路径严格校验）。
 *
 * @module infra/llm-protocol/logic/tool-arguments-parse
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { LlmProtocolKind } from "../ports/adapter.port.js";

function truncate(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) {
    return raw;
  }
  return raw.slice(0, maxLen) + "…";
}

export type TryParseToolArgumentsResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly raw: string };

/** finish 路径：非法 JSON 返回 `{ ok: false, raw }`，不抛错。 */
export function tryParseToolArgumentsJson(
  raw: string,
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

/** 解析 tool arguments；空串为 {}，非空非法 JSON 抛错。 */
export function parseToolArgumentsJson(
  raw: string,
  protocol: LlmProtocolKind,
): Record<string, unknown> {
  const parsed = tryParseToolArgumentsJson(raw);
  if (parsed.ok) {
    return parsed.value;
  }
  throw new ProviderError(
    "INVALID_TOOL_ARGUMENTS",
    `${protocol}: invalid tool arguments JSON (${truncate(parsed.raw, 80)})`,
  );
}
