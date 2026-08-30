/**
 * Bootstrap 内置 LLM provider 单行定义（固定 UUID、builtin_key、protocol、baseUrl、displayName）。
 *
 * @module domain/provider/logic/builtin-providers
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** 内置 provider 种子行，与 PRD 内置表一致。 */
export type BuiltinProviderSeedRow = {
  /** 稳定业务键（seed 幂等 / 协议护栏）；不对用户展示。 */
  readonly key: string;
  /** 跨安装一致的固定技术主键 UUID。 */
  readonly id: string;
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  readonly displayName: string;
  /** SKSP 未配置时使用的内置默认 apiKey（仅部分内置服务商）。 */
  readonly defaultApiKey?: string;
};

/** 内置 OpenAI 固定 UUID。 */
export const BUILTIN_PROVIDER_UUID_OPENAI =
  "c0ffeeee-0001-4000-8000-000000000001";
/** 内置 Anthropic 固定 UUID。 */
export const BUILTIN_PROVIDER_UUID_ANTHROPIC =
  "c0ffeeee-0001-4000-8000-000000000002";
/** 内置 Google Gemini 固定 UUID。 */
export const BUILTIN_PROVIDER_UUID_GOOGLE =
  "c0ffeeee-0001-4000-8000-000000000003";
/** 内置 OpenRouter 固定 UUID。 */
export const BUILTIN_PROVIDER_UUID_OPENROUTER =
  "c0ffeeee-0001-4000-8000-000000000004";
/** 内置 OpenCode Zen 固定 UUID。 */
export const BUILTIN_PROVIDER_UUID_OPENCODE =
  "c0ffeeee-0001-4000-8000-000000000005";

/** 单一数据源：内置 provider 列表。 */
export const BUILTIN_PROVIDER_ROWS: readonly BuiltinProviderSeedRow[] = [
  {
    key: "openai",
    id: BUILTIN_PROVIDER_UUID_OPENAI,
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    displayName: "OpenAI",
  },
  {
    key: "anthropic",
    id: BUILTIN_PROVIDER_UUID_ANTHROPIC,
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    displayName: "Anthropic",
  },
  {
    key: "google",
    id: BUILTIN_PROVIDER_UUID_GOOGLE,
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    displayName: "Google Gemini",
  },
  {
    key: "openrouter",
    id: BUILTIN_PROVIDER_UUID_OPENROUTER,
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    displayName: "OpenRouter",
  },
  {
    key: "opencode",
    id: BUILTIN_PROVIDER_UUID_OPENCODE,
    protocol: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    displayName: "OpenCode Zen",
    defaultApiKey: "public",
  },
] as const;

const BUILTIN_DEFAULT_API_KEY_BY_KEY: Readonly<Record<string, string>> =
  Object.fromEntries(
    BUILTIN_PROVIDER_ROWS.flatMap((row) =>
      row.defaultApiKey != null ? [[row.key, row.defaultApiKey]] : []
    )
  );

/** 内置 provider 在无 SKSP 密钥时的默认 apiKey；按 builtin_key 查；无则 undefined。 */
export function builtinDefaultApiKey(builtinKey: string): string | undefined {
  return BUILTIN_DEFAULT_API_KEY_BY_KEY[builtinKey];
}

/** builtin_key → LLM 协议种类（由 BUILTIN_PROVIDER_ROWS 派生）。 */
export const BUILTIN_PROVIDER_PROTOCOLS: Readonly<
  Record<string, LlmProtocolKind>
> = Object.fromEntries(
  BUILTIN_PROVIDER_ROWS.map((row) => [row.key, row.protocol])
) as Readonly<Record<string, LlmProtocolKind>>;

/** 固定 UUID → 协议（与 seed 同源，禁止另维护第二套）。 */
export const BUILTIN_PROVIDER_UUID_PROTOCOLS: Readonly<
  Record<string, LlmProtocolKind>
> = Object.fromEntries(
  BUILTIN_PROVIDER_ROWS.map((row) => [row.id, row.protocol])
) as Readonly<Record<string, LlmProtocolKind>>;

/** 旧 slug / builtin_key → 固定 UUID。 */
export const BUILTIN_KEY_TO_UUID: Readonly<Record<string, string>> =
  Object.fromEntries(
    BUILTIN_PROVIDER_ROWS.map((row) => [row.key, row.id])
  ) as Readonly<Record<string, string>>;

/** 固定 UUID → builtin_key。 */
export const BUILTIN_UUID_TO_KEY: Readonly<Record<string, string>> =
  Object.fromEntries(
    BUILTIN_PROVIDER_ROWS.map((row) => [row.id, row.key])
  ) as Readonly<Record<string, string>>;

/**
 * 内置 provider 业务键列表（冻结，顺序与种子行一致）。
 * 兼容旧名 {@link BUILTIN_PROVIDER_IDS} 的语义已迁移为 keys。
 */
export const BUILTIN_PROVIDER_KEYS = Object.freeze(
  BUILTIN_PROVIDER_ROWS.map((row) => row.key)
) as readonly string[];

/** @deprecated 请用 {@link BUILTIN_PROVIDER_KEYS}；现为 builtin_key 列表而非 UUID。 */
export const BUILTIN_PROVIDER_IDS = BUILTIN_PROVIDER_KEYS;

/** 内置固定 UUID 列表。 */
export const BUILTIN_PROVIDER_UUIDS = Object.freeze(
  BUILTIN_PROVIDER_ROWS.map((row) => row.id)
) as readonly string[];

/** 按 builtin_key 查内置 protocol；非内置 key 返回 undefined。 */
export function builtinProtocolByProviderKey(
  key: string
): LlmProtocolKind | undefined {
  return BUILTIN_PROVIDER_PROTOCOLS[key];
}

/** @deprecated 请用 {@link builtinProtocolByProviderKey}。 */
export function builtinProtocolByProviderId(
  idOrKey: string
): LlmProtocolKind | undefined {
  return (
    BUILTIN_PROVIDER_PROTOCOLS[idOrKey] ??
    BUILTIN_PROVIDER_UUID_PROTOCOLS[idOrKey]
  );
}
