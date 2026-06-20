/**
 * LLM provider entity.
 *
 * @module domain/provider/model/provider
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface LlmProvider {
  readonly id: string;
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  readonly displayName: string | null;
  readonly secretRef: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly isBuiltin: boolean;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

/** Standard secret ref for a provider API key. */
export function providerApiKeyRef(providerId: string): string {
  return `provider/${providerId}/apiKey`;
}

/** 解析 provider API 密钥 SKSP ref（list 状态、请求、delete、edit 共用）。 */
export function resolveProviderApiKeySecretRef(
  provider: Pick<LlmProvider, "id" | "secretRef">,
): string {
  return provider.secretRef ?? providerApiKeyRef(provider.id);
}
