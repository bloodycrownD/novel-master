/**
 * Resolves `--providerId` / `--modelId` from CLI flags or {@link PersistentState}.
 *
 * @module config/resolve-provider-scope
 */

import type { PersistentState } from "@novel-master/core";

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
    "Missing --providerId <id> (or run: nm provider use --providerId <id>)",
  );
}

/** Resolves model id: flag > state > error. */
export async function resolveModelId(
  flags: ReadonlyMap<string, string | true>,
  state: PersistentState,
): Promise<string> {
  const fromFlag = flagString(flags, "modelId");
  if (fromFlag != null) {
    return fromFlag;
  }
  const fromState = await state.getCurrentModelId();
  if (fromState != null && fromState !== "") {
    return fromState;
  }
  throw new Error(
    "Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)",
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
  throw new Error("Missing --providerId <id>");
}
