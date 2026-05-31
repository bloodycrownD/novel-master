/**
 * Model id / label helpers for workspace applicationModelId.
 */
import {parseApplicationModelId} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Canonical model id for display: `providerId/vendorModelId`. */
export async function resolveModelDisplayLabel(
  _runtime: MobileNovelMasterRuntime,
  applicationModelId: string,
): Promise<string> {
  parseApplicationModelId(applicationModelId);
  return applicationModelId;
}

/** Compact title (displayName or vendor id without provider prefix). */
export async function resolveModelShortLabel(
  runtime: MobileNovelMasterRuntime,
  applicationModelId: string,
): Promise<string> {
  const {providerId, vendorModelId} =
    parseApplicationModelId(applicationModelId);
  const saved = await runtime.providerModels.savedList(providerId);
  const match = saved.find(m => m.vendorModelId === vendorModelId);
  return match?.displayName?.trim() || vendorModelId;
}
