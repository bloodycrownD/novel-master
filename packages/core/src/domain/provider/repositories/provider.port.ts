import type { LlmProvider } from "../model/provider.js";

export interface ProviderRepository {
  list(): Promise<LlmProvider[]>;
  findById(id: string): Promise<LlmProvider | null>;
  insert(provider: LlmProvider): Promise<void>;
  update(provider: LlmProvider): Promise<void>;
  delete(id: string): Promise<boolean>;
}
