/**
 * 从 application model id 推断 LLM 协议种类（export 路径用）。
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { parseApplicationModelId } from "./application-model-id.js";

const PROTOCOL_BY_PROVIDER_ID: Readonly<Record<string, LlmProtocolKind>> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
};

/**
 * 解析 `providerId/vendorModelId` 中的 providerId；未知时回退 anthropic。
 */
export function inferLlmProtocolFromApplicationModelId(
  applicationModelId: string,
): LlmProtocolKind {
  try {
    const { providerId } = parseApplicationModelId(applicationModelId);
    return PROTOCOL_BY_PROVIDER_ID[providerId] ?? "anthropic";
  } catch {
    return "anthropic";
  }
}
