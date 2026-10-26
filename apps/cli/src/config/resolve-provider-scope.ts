/**
 * Resolves `--providerId` / `--modelId` from CLI flags or {@link PersistentState}.
 *
 * @module config/resolve-provider-scope
 */

import type { PersistentState } from "@novel-master/core";
import {
  assertSavedModelUuid,
  type ProviderServiceBundle,
} from "@novel-master/core/provider";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Resolves provider id: flag > state > error. */
export async function resolveProviderId(
  flags: ReadonlyMap<string, string | true>,
  state: PersistentState,
): Promise<string> {
  const fromFlag = flagString(flags, "providerId");
  if (fromFlag != null) {
    return fromFlag;
  }
  const fromState = await state.getCurrentProviderId();
  if (fromState != null && fromState !== "") {
    return fromState;
  }
  throw new Error(
    "Missing --providerId <uuid> (or run: nm provider use --providerId <uuid>)",
  );
}

/** Unwraps the Result-based saved-model lookup at the CLI boundary. */
async function requireSavedModelId(savedModelId: string, savedModels: ProviderServiceBundle["savedModelRepo"]): Promise<string> {
  const saved = await assertSavedModelUuid(savedModelId, savedModels);
  if (!saved.ok) throw saved.error;
  return saved.value.id;
}

/** Resolves saved model UUID: flag > state > error. */
export async function resolveModelId(
  flags: ReadonlyMap<string, string | true>,
  state: PersistentState,
  savedModels: ProviderServiceBundle["savedModelRepo"],
): Promise<string> {
  const fromFlag = flagString(flags, "modelId");
  if (fromFlag != null) {
    return requireSavedModelId(fromFlag, savedModels);
  }
  const fromState = await state.getCurrentModelId();
  if (fromState != null && fromState !== "") {
    return requireSavedModelId(fromState, savedModels);
  }
  throw new Error(
    "Missing --modelId <uuid> (or run: nm model use --modelId <uuid>)",
  );
}

/** Requires explicit `--providerId` (no state fallback). */
export function requireProviderId(
  flags: ReadonlyMap<string, string | true>,
): string {
  const fromFlag = flagString(flags, "providerId");
  if (fromFlag != null) {
    return fromFlag;
  }
  throw new Error("Missing --providerId <uuid>");
}
