import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";
import type { SavedModel } from "@/domain/provider/model/saved-model.js";
import type { SavedModelSettingsPatch } from "@/domain/provider/model/saved-model-settings.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";

export interface ProviderModelService {
  /** 已知失败走返回值（五期门⑦）：域校验 / NOT_FOUND / 解包失败收 `Result.err`；未知异常仍抛。 */
  suggestList(providerId: string): Promise<Result<ModelSuggestion[], AppError>>;
  /**
   * 拉取模型列表并落库建议。
   *
   * `scope` 透传到 `adapter.listModels` → 网络请求的 signal；缺省视为不可取消
   * （CLI / 旧调用点）。
   */
  fetch(providerId: string, scope?: AbortScope): Promise<Result<void, AppError>>;
  /** 已知失败走返回值（五期门⑦）：模型名非法收 `Result.err`；未知异常仍抛。 */
  save(
    providerId: string,
    vendorModelId: string,
    modelName?: string
  ): Promise<Result<SavedModel, AppError>>;
  create(providerId: string, vendorModelId: string): Promise<Result<SavedModel, AppError>>;
  savedList(providerId: string): Promise<Result<SavedModel[], AppError>>;
  /** When `modelName` is omitted, existing model name is kept. */
  editSaved(savedModelId: string, modelName?: string): Promise<Result<SavedModel, AppError>>;
  deleteSaved(savedModelId: string): Promise<Result<void, AppError>>;

  updateSettings(
    savedModelId: string,
    patch: SavedModelSettingsPatch
  ): Promise<Result<SavedModel, AppError>>;

  resetContextWindowToDefault(savedModelId: string): Promise<Result<SavedModel, AppError>>;

  getSavedById(savedModelId: string): Promise<Result<SavedModel | null, AppError>>;
  getContextWindow(savedModelId: string): Promise<Result<number | null, AppError>>;
  getTokenCounterMode(savedModelId: string): Promise<Result<TokenizerOverride, AppError>>;
}
