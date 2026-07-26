/**
 * LLM provider 实体。
 *
 * @module domain/provider/model/provider
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface LlmProvider {
  readonly id: string;
  /** 仅内置行非空：openai / anthropic / …；自定义为 null。 */
  readonly builtinKey: string | null;
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  /** 对人展示名称；必填非空。 */
  readonly displayName: string;
  readonly secretRef: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly isBuiltin: boolean;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** 标准 provider API Key 的 SKSP ref。 */
export function providerApiKeyRef(providerId: string): string {
  return `provider/${providerId}/apiKey`;
}

/** 解析 provider API 密钥 SKSP ref（list 状态、请求、delete、edit 共用）。 */
export function resolveProviderApiKeySecretRef(
  provider: Pick<LlmProvider, "id" | "secretRef">,
): string {
  return provider.secretRef ?? providerApiKeyRef(provider.id);
}
