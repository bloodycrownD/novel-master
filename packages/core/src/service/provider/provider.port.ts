import type { LlmProvider } from "@/domain/provider/model/provider.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface CreateProviderInput {
  readonly id: string;
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  readonly displayName?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly defaultModelId?: string;
  readonly apiKey?: string;
}

export interface EditProviderPatch {
  readonly protocol?: LlmProtocolKind;
  readonly baseUrl?: string;
  readonly displayName?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  readonly defaultModelId?: string | null;
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
