/**
 * Saved model label helpers for workspace currentModelId (UUID).
 */
import {formatSavedModelDisplayName} from '@novel-master/core/provider';
import {type AppError, Result} from '@novel-master/core/errors';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Primary row label: derived displayName (`服务商名称/modelName`). */
export async function resolveModelDisplayLabel(runtime: MobileNovelMasterRuntime, savedModelId: string): Promise<Result<string, AppError>> {
  const saved = await runtime.providerModels.getSavedById(savedModelId);
  if (!saved.ok) return Result.err(saved.error);
  if (saved.value == null) {
    return Result.ok(savedModelId);
  }
  const provider = await runtime.providers.get(saved.value.providerId);
  if (!provider.ok) return Result.err(provider.error);
  return Result.ok(formatSavedModelDisplayName(provider.value.displayName, saved.value.modelName));
}
