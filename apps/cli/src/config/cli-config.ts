/**
 * CLI-local `config.json` beside the resolved DB file.
 *
 * @module config/cli-config
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliConfigError } from "./cli-config-errors.js";

/** Persisted current project / session / provider / model ids (CLI only). */
export interface CliConfig {
  readonly currentProjectId?: string;
  readonly currentSessionId?: string;
  readonly currentProviderId?: string;
  readonly currentModelId?: string;
}

/**
 * Path to `config.json` in the same directory as the SQLite DB file.
 */
export function resolveConfigPath(dbPath: string): string {
  return join(dirname(dbPath), "config.json");
}

function normalizeField(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") {
    return undefined;
  }
  return value;
}

function normalizeConfig(raw: unknown): CliConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const config: {
    currentProjectId?: string;
    currentSessionId?: string;
    currentProviderId?: string;
    currentModelId?: string;
  } = {};
  const projectId = normalizeField(record.currentProjectId);
  const sessionId = normalizeField(record.currentSessionId);
  const providerId = normalizeField(record.currentProviderId);
  const modelId = normalizeField(record.currentModelId);
  if (projectId != null) {
    config.currentProjectId = projectId;
  }
  if (sessionId != null) {
    config.currentSessionId = sessionId;
  }
  if (providerId != null) {
    config.currentProviderId = providerId;
  }
  if (modelId != null) {
    config.currentModelId = modelId;
  }
  return config;
}

/**
 * Loads CLI config; missing file yields `{}`.
 *
 * @throws {CliConfigError} When the file exists but JSON is invalid.
 */
export async function loadCliConfig(path: string): Promise<CliConfig> {
  try {
    const text = await readFile(path, "utf8");
    try {
      return normalizeConfig(JSON.parse(text) as unknown);
    } catch {
      throw new CliConfigError(`Invalid JSON in CLI config: ${path}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function mergeConfig(existing: CliConfig, patch: Partial<CliConfig>): CliConfig {
  const next: {
    currentProjectId?: string;
    currentSessionId?: string;
    currentProviderId?: string;
    currentModelId?: string;
  } = { ...existing };
  for (const key of [
    "currentProjectId",
    "currentSessionId",
    "currentProviderId",
    "currentModelId",
  ] as const) {
    if (!(key in patch)) {
      continue;
    }
    const value = patch[key];
    if (value == null || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Merges `patch` into existing config and writes atomically via a pid-suffixed temp file.
 */
export async function saveCliConfig(
  path: string,
  patch: Partial<CliConfig>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = await loadCliConfig(path);
  const merged = mergeConfig(existing, patch);
  const tmpPath = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(merged, null, 2)}\n`;
  await writeFile(tmpPath, body, "utf8");
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await rename(tmpPath, path);
}

/** Merges a patch into an in-memory config snapshot (same rules as {@link saveCliConfig}). */
export function mergeCliConfig(
  existing: CliConfig,
  patch: Partial<CliConfig>,
): CliConfig {
  return mergeConfig(existing, patch);
}
