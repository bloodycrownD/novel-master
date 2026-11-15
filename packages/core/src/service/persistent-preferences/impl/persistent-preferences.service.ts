/**
 * Default {@link PersistentPreferences} backed by internal KKV.
 *
 * @module service/persistent-preferences/impl/persistent-preferences.service
 */

import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { formatBoolean, parseBoolean } from "@/infra/kkv-value-codec.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { PersistentPreferences } from "../persistent-preferences.port.js";
import {
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SUBAGENT_STREAM,
  PREF_KEY_CHAT_THINKING_CONTEXT,
  PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN,
  PREFERENCES_MODULE,
} from "./preference-keys.js";

export class DefaultPersistentPreferences implements PersistentPreferences {
  constructor(private readonly kkv: KkvService) {}

  async getLlmStreamEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref(PREF_KEY_CHAT_LLM_STREAM, true);
  }

  async setLlmStreamEnabled(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_CHAT_LLM_STREAM,
      formatBoolean(enabled)
    );
  }

  async resetLlmStreamEnabled(): Promise<Result<void, AppError>> {
    return this.deletePref(PREF_KEY_CHAT_LLM_STREAM);
  }

  async getSubagentStreamEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref(PREF_KEY_CHAT_SUBAGENT_STREAM, true);
  }

  async setSubagentStreamEnabled(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_CHAT_SUBAGENT_STREAM,
      formatBoolean(enabled)
    );
  }

  async resetSubagentStreamEnabled(): Promise<Result<void, AppError>> {
    return this.deletePref(PREF_KEY_CHAT_SUBAGENT_STREAM);
  }

  async getThinkingContextEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref(PREF_KEY_CHAT_THINKING_CONTEXT, false);
  }

  async setThinkingContextEnabled(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_CHAT_THINKING_CONTEXT,
      formatBoolean(enabled)
    );
  }

  async resetThinkingContextEnabled(): Promise<Result<void, AppError>> {
    return this.deletePref(PREF_KEY_CHAT_THINKING_CONTEXT);
  }

  async getUserVfsUnifiedToolTurn(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref(PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN, true);
  }

  async setUserVfsUnifiedToolTurn(enabled: boolean): Promise<void> {
    await this.kkv.set(
      PREFERENCES_MODULE,
      PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN,
      formatBoolean(enabled)
    );
  }

  async resetUserVfsUnifiedToolTurn(): Promise<Result<void, AppError>> {
    return this.deletePref(PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN);
  }

  async list(): Promise<ReadonlyArray<{ key: string; value: string }>> {
    const keys = await this.kkv.listKeys(PREFERENCES_MODULE);
    const entries: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      const value = await this.kkv.get(PREFERENCES_MODULE, key);
      // Skip keys removed between list and get（KKV_NOT_FOUND 走 Err 通道）
      if (!value.ok) continue;
      entries.push({ key, value: value.value });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }

  async getPreference(key: string): Promise<Result<string | undefined, AppError>> {
    return this.getRaw(key);
  }

  async setPreference(key: string, value: string): Promise<void> {
    await this.kkv.set(PREFERENCES_MODULE, key, value);
  }

  private async getBooleanPref(key: string, defaultValue: boolean): Promise<Result<boolean, AppError>> {
    const raw = await this.getRaw(key);
    if (!raw.ok) return Result.err(raw.error);
    if (raw.value === undefined) return Result.ok(defaultValue);
    const parsed = parseBoolean(raw.value);
    if (!parsed.ok) return Result.err(new AppError("PREFERENCES_INVALID_VALUE", { detail: `Preference key "${key}" expected boolean, got: ${raw.value}`, key, expectedType: "boolean", actualValue: raw.value }));
    return Result.ok(parsed.value);
  }

  /** `KKV_NOT_FOUND` 归一为 `undefined`，其余 KKV 失败经 `Result.err` 原样接力。 */
  private async getRaw(key: string): Promise<Result<string | undefined, AppError>> {
    const raw = await this.kkv.get(PREFERENCES_MODULE, key);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    return Result.ok(raw.ok ? raw.value : undefined);
  }

  /** `KKV_NOT_FOUND` 幂等归一为成功；其余 KKV 失败经 `Result.err` 原样接力。 */
  private async deletePref(key: string): Promise<Result<void, AppError>> {
    const deleted = await this.kkv.delete(PREFERENCES_MODULE, key);
    if (!deleted.ok && !isAppError(deleted.error, "KKV_NOT_FOUND")) return deleted;
    return Result.ok(undefined);
  }
}
