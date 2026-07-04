/**
 * Saved model label helpers for workspace currentModelId (UUID).
 */
import {formatSavedModelDisplayName} from '@novel-master/core/provider';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Primary row label: derived displayName (`provider/modelName`). */
export async function resolveModelDisplayLabel(
  runtime: MobileNovelMasterRuntime,
  savedModelId: string,
): Promise<string> {
  const saved = await runtime.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  return formatSavedModelDisplayName(saved.providerId, saved.modelName);
}

/** Compact title: persisted modelName (not derived path). */
export async function resolveModelShortLabel(
  runtime: MobileNovelMasterRuntime,
  savedModelId: string,
): Promise<string> {
  const saved = await runtime.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  return saved.modelName.trim() || saved.vendorModelId;
}
