/**
 * Resolves `--providerId` / `--modelId` from CLI flags or `config.json`.
 *
 * @module config/resolve-provider-scope
 */

import type { CliConfig } from "./cli-config.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Resolves provider id: flag > config > error. */
export function resolveProviderId(
  flags: ReadonlyMap<string, string | true>,
  config: CliConfig,
): string {
  const fromFlag = flagString(flags, "providerId");
  if (fromFlag != null) {
    return fromFlag;
  }
  const fromConfig = config.currentProviderId;
  if (fromConfig != null && fromConfig !== "") {
    return fromConfig;
  }
  throw new Error(
    "Missing --providerId <id> (or run: nm provider use --providerId <id>)",
  );
}

/** Resolves model id: flag > config > error. */
export function resolveModelId(
  flags: ReadonlyMap<string, string | true>,
  config: CliConfig,
): string {
  const fromFlag = flagString(flags, "modelId");
  if (fromFlag != null) {
    return fromFlag;
  }
  const fromConfig = config.currentModelId;
  if (fromConfig != null && fromConfig !== "") {
    return fromConfig;
  }
  throw new Error(
    "Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)",
  );
}

/** Requires explicit `--providerId` (no config fallback). */
export function requireProviderId(
  flags: ReadonlyMap<string, string | true>,
): string {
  const fromFlag = flagString(flags, "providerId");
  if (fromFlag != null) {
    return fromFlag;
  }
  throw new Error("Missing --providerId <id>");
}
