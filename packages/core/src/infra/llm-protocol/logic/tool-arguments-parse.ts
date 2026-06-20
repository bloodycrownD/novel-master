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

/** 解析 tool arguments；空串为 {}，非空非法 JSON 抛错。 */
export function parseToolArgumentsJson(
  raw: string,
  protocol: LlmProtocolKind,
): Record<string, unknown> {
  if (raw === "") {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ProviderError(
      "INVALID_TOOL_ARGUMENTS",
      `${protocol}: invalid tool arguments JSON (${truncate(raw, 80)})`,
    );
  }
}
