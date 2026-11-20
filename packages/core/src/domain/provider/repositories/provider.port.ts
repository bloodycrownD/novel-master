import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { LlmProvider } from "../model/provider.js";

export interface ProviderRepository {
  list(): Promise<Result<LlmProvider[], AppError>>;
  findById(id: string): Promise<Result<LlmProvider | null, AppError>>;
  insert(provider: LlmProvider): Promise<void>;
  update(provider: LlmProvider): Promise<void>;
  delete(id: string): Promise<boolean>;
}
