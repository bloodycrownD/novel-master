import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { ModelSuggestion } from "../model/model-suggestion.js";

export interface ModelSuggestionRepository {
    listByProvider(providerId: string): Promise<Result<ModelSuggestion[], AppError>>;
    upsert(suggestion: ModelSuggestion): Promise<Result<void, AppError>>;
    markStaleExcept(providerId: string, seen: ReadonlySet<string>): Promise<Result<void, AppError>>;
    /** `KKV_NOT_FOUND` 幂等归一为成功；其余失败经 `Result.err` 原样接力。 */
    deleteByProvider(providerId: string): Promise<Result<void, AppError>>;
}
