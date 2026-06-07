/**
 * Default {@link PersistentPreferences} backed by internal KKV.
 *
 * @module service/persistent-preferences/impl/persistent-preferences.service
 */

import { isKkvError } from "@/errors/kkv-errors.js";
import { preferencesInvalidValue } from "@/errors/preferences-errors.js";
import { formatBoolean, parseBoolean } from "@/infra/kkv-value-codec.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { PersistentPreferences } from "../persistent-preferences.port.js";
import {
  DEFAULT_CHECKPOINT_RETENTION,
  MAX_CHECKPOINT_RETENTION,
  MIN_CHECKPOINT_RETENTION,
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
  PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
  PREF_KEY_SESSION_FS_VERSION_CHECK,
  PREFERENCES_MODULE,
} from "./preference-keys.js";

function parseCheckpointRetention(
  key: string,
  raw: string,
): number {
  const n = Number.parseInt(raw, 10);
  if (
    !Number.isFinite(n) ||
    String(n) !== raw.trim() ||
    n < MIN_CHECKPOINT_RETENTION ||
    n > MAX_CHECKPOINT_RETENTION
  ) {
    throw preferencesInvalidValue(
      key,
      `positive integer ${MIN_CHECKPOINT_RETENTION}..${MAX_CHECKPOINT_RETENTION}`,
      raw,
    );
  }
  return n;
}

function assertCheckpointRetentionInput(count: number): void {
  if (
    !Number.isInteger(count) ||
    count < MIN_CHECKPOINT_RETENTION ||
    count > MAX_CHECKPOINT_RETENTION
  ) {
    throw preferencesInvalidValue(
      PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
      `positive integer ${MIN_CHECKPOINT_RETENTION}..${MAX_CHECKPOINT_RETENTION}`,
      String(count),
    );
  }
}

export class DefaultPersistentPreferences implements PersistentPreferences {
  constructor(private readonly kkv: KkvService) {}

  async getSessionFsVersionCheck(): Promise<boolean> {
    return this.getBooleanPref(
      PREF_KEY_SESSION_FS_VERSION_CHECK,
      true,
    );
  }

  async setSessionFsVersionCheck(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_SESSION_FS_VERSION_CHECK,
      formatBoolean(enabled),
    );
  }

  async resetSessionFsVersionCheck(): Promise<void> {
    await this.deletePref(PREF_KEY_SESSION_FS_VERSION_CHECK);
  }

  async getLlmStreamEnabled(): Promise<boolean> {
    return this.getBooleanPref(PREF_KEY_CHAT_LLM_STREAM, true);
  }

  async setLlmStreamEnabled(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_CHAT_LLM_STREAM,
      formatBoolean(enabled),
    );
  }

  async resetLlmStreamEnabled(): Promise<void> {
    await this.deletePref(PREF_KEY_CHAT_LLM_STREAM);
  }

  async getShowFullToolParams(): Promise<boolean> {
    return this.getBooleanPref(PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS, false);
  }

  async setShowFullToolParams(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
      formatBoolean(enabled),
    );
  }

  async resetShowFullToolParams(): Promise<void> {
    await this.deletePref(PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS);
  }

  async getCheckpointRetention(): Promise<number> {
    const raw = await this.getRaw(PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION);
    if (raw === undefined) {
      return DEFAULT_CHECKPOINT_RETENTION;
    }
    return parseCheckpointRetention(
      PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
      raw,
    );
  }

  async setCheckpointRetention(count: number): Promise<void> {
    assertCheckpointRetentionInput(count);
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
      String(count),
    );
  }

  async resetCheckpointRetention(): Promise<void> {
    await this.deletePref(PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION);
  }

  async list(): Promise<ReadonlyArray<{ key: string; value: string }>> {
    const keys = await this.kkv.listKeys(PREFERENCES_MODULE);
    const entries: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      try {
        const value = await this.kkv.get(PREFERENCES_MODULE, key);
        entries.push({ key, value });
      } catch {
        // Skip keys removed between list and get
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }

  async getPreference(key: string): Promise<string | undefined> {
    return this.getRaw(key);
  }

  async setPreference(key: string, value: string): Promise<void> {
    await this.kkv.set(PREFERENCES_MODULE, key, value);
  }

  private async getBooleanPref(
    key: string,
    defaultValue: boolean,
  ): Promise<boolean> {
    const raw = await this.getRaw(key);
    if (raw === undefined) {
      return defaultValue;
    }
    try {
      return parseBoolean(raw);
    } catch {
      throw preferencesInvalidValue(key, "boolean", raw);
    }
  }

  private async getRaw(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(PREFERENCES_MODULE, key);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }

  private async deletePref(key: string): Promise<void> {
    try {
      await this.kkv.delete(PREFERENCES_MODULE, key);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }
}
