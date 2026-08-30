/**
 * Saved model label helpers for workspace currentModelId (UUID).
 */
import {formatSavedModelDisplayName} from '@novel-master/core/provider';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Primary row label: derived displayName (`服务商名称/modelName`). */
export async function resolveModelDisplayLabel(
  runtime: MobileNovelMasterRuntime,
  savedModelId: string,
): Promise<string> {
  const saved = await runtime.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  const provider = await runtime.providers.get(saved.providerId);
  return formatSavedModelDisplayName(provider.displayName, saved.modelName);
}

