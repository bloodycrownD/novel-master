import type { LlmProvider } from "@/domain/provider/model/provider.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface CreateProviderInput {
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  /** trim 后非空，否则 INVALID_ARGUMENT。 */
  readonly displayName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly apiKey?: string;
}

export interface EditProviderPatch {
  readonly protocol?: LlmProtocolKind;
  readonly baseUrl?: string;
  /** 若出现则 trim 后必须非空（禁止写回 null / 空白）。 */
  readonly displayName?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly apiKey?: string;
}

export interface ProviderListItem extends LlmProvider {
  readonly apiKeyStatus: "set" | "not set";
}

export interface ProviderService {
  list(): Promise<ProviderListItem[]>;
  get(id: string): Promise<LlmProvider>;
  create(input: CreateProviderInput): Promise<LlmProvider>;
  edit(id: string, patch: EditProviderPatch): Promise<LlmProvider>;
  delete(id: string): Promise<void>;
}
