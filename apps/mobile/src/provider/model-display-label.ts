/**
 * Human-readable label for workspace applicationModelId (saved model displayName or vendor id).
 */
import {parseApplicationModelId} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export async function resolveModelDisplayLabel(
  runtime: MobileNovelMasterRuntime,
  applicationModelId: string,
): Promise<string> {
  const {providerId, vendorModelId} =
    parseApplicationModelId(applicationModelId);
  const saved = await runtime.providerModels.savedList(providerId);
  const match = saved.find(m => m.vendorModelId === vendorModelId);
  return match?.displayName?.trim() || vendorModelId;
}
