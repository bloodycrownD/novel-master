/**
 * Bootstrap 内置 LLM provider 单行定义（id、protocol、baseUrl、displayName）。
 *
 * @module domain/provider/logic/builtin-providers
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** 内置 provider 种子行，与 PRD 内置表一致。 */
export type BuiltinProviderSeedRow = {
  readonly id: string;
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  readonly displayName: string;
};

/** 单一数据源：内置 provider 列表。 */
export const BUILTIN_PROVIDER_ROWS: readonly BuiltinProviderSeedRow[] = [
  {
    id: "openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    displayName: "OpenAI",
  },
  {
    id: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    displayName: "Anthropic",
  },
  {
    id: "google",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    displayName: "Google Gemini",
  },
  {
    id: "openrouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    displayName: "OpenRouter",
  },
] as const;

/** provider id → LLM 协议种类（由 BUILTIN_PROVIDER_ROWS 派生）。 */
export const BUILTIN_PROVIDER_PROTOCOLS: Readonly<
  Record<string, LlmProtocolKind>
> = Object.fromEntries(
  BUILTIN_PROVIDER_ROWS.map((row) => [row.id, row.protocol]),
) as Readonly<Record<string, LlmProtocolKind>>;

/** 内置 provider id 列表（冻结，顺序与种子行一致）。 */
export const BUILTIN_PROVIDER_IDS = Object.freeze(
  BUILTIN_PROVIDER_ROWS.map((row) => row.id),
) as readonly string[];

/** 按 provider id 查内置 protocol；非内置 id 返回 undefined。 */
export function builtinProtocolByProviderId(
  id: string,
): LlmProtocolKind | undefined {
  return BUILTIN_PROVIDER_PROTOCOLS[id];
}
