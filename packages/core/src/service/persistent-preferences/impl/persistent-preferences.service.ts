/**
 * Default {@link PersistentPreferences} backed by internal KKV.
 *
 * @module service/persistent-preferences/impl/persistent-preferences.service
 */

import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { Kkv } from "@/common/kkv.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { PersistentPreferences } from "../persistent-preferences.port.js";
import { PREF_KEY_CHAT_LLM_STREAM, PREF_KEY_CHAT_SUBAGENT_STREAM, PREF_KEY_CHAT_THINKING_CONTEXT, PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN, PREFERENCES_MODULE } from "./preference-keys.js";

/** 布尔偏好配置：新增开关只加一行，公开三元组方法名保持不变（调用方零改动）。 */
const BOOLEAN_PREFS = {
  llmStream: { key: PREF_KEY_CHAT_LLM_STREAM, defaultValue: true },
  subagentStream: { key: PREF_KEY_CHAT_SUBAGENT_STREAM, defaultValue: true },
  thinkingContext: { key: PREF_KEY_CHAT_THINKING_CONTEXT, defaultValue: false },
  userVfsUnifiedToolTurn: { key: PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN, defaultValue: true },
} as const;

type BooleanPrefName = keyof typeof BOOLEAN_PREFS;

export class DefaultPersistentPreferences implements PersistentPreferences {
  constructor(private readonly kkv: KkvService) {}

  async getLlmStreamEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref("llmStream");
  }

  async setLlmStreamEnabled(enabled: boolean): Promise<void> {
    await this.setBooleanPref("llmStream", enabled);
  }

  /** nm-style: keep-public — PersistentPreferences 端口方法；CLI preferences-cmd 重置单点消费。 */
  async resetLlmStreamEnabled(): Promise<Result<void, AppError>> {
    return this.resetBooleanPref("llmStream");
  }

  async getSubagentStreamEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref("subagentStream");
  }

  async setSubagentStreamEnabled(enabled: boolean): Promise<void> {
    await this.setBooleanPref("subagentStream", enabled);
  }

  /** nm-style: keep-public — PersistentPreferences 端口方法；CLI preferences-cmd 重置单点消费。 */
  async resetSubagentStreamEnabled(): Promise<Result<void, AppError>> {
    return this.resetBooleanPref("subagentStream");
  }

  async getThinkingContextEnabled(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref("thinkingContext");
  }

  async setThinkingContextEnabled(enabled: boolean): Promise<void> {
    await this.setBooleanPref("thinkingContext", enabled);
  }

  /** nm-style: keep-public — PersistentPreferences 端口方法；CLI preferences-cmd 重置单点消费。 */
  async resetThinkingContextEnabled(): Promise<Result<void, AppError>> {
    return this.resetBooleanPref("thinkingContext");
  }

  async getUserVfsUnifiedToolTurn(): Promise<Result<boolean, AppError>> {
    return this.getBooleanPref("userVfsUnifiedToolTurn");
  }

  /** nm-style: keep-public — PersistentPreferences 端口方法；CLI preferences-cmd 与桌面 IPC preferences 表两处写入消费。 */
  async setUserVfsUnifiedToolTurn(enabled: boolean): Promise<void> {
    await this.setBooleanPref("userVfsUnifiedToolTurn", enabled);
  }

  /** nm-style: keep-public — PersistentPreferences 端口方法；CLI preferences-cmd 重置单点消费。 */
  async resetUserVfsUnifiedToolTurn(): Promise<Result<void, AppError>> {
    return this.resetBooleanPref("userVfsUnifiedToolTurn");
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

  /**
   * 原始偏好值（未设置为 `undefined`）；`KKV_NOT_FOUND` 归一为 `undefined`，其余 KKV 失败经 `Result.err` 原样接力。
   *
   * nm-style: keep-public — PersistentPreferences 端口 raw 读口（public barrel 导出类型）；实现类必须提供，外部暂无调用；撤口需同步端口/barrel（跨分片）。
   */
  async getPreference(key: string): Promise<Result<string | undefined, AppError>> {
    const raw = await this.kkv.get(PREFERENCES_MODULE, key);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    return Result.ok(raw.ok ? raw.value : undefined);
  }

  /**
   * 写入原始偏好值。
   *
   * nm-style: keep-public — PersistentPreferences 端口 raw 写口（public barrel 导出类型）；实现类必须提供，生产暂无调用，撤口需同步端口/barrel（跨分片）。
   */
  async setPreference(key: string, value: string): Promise<void> {
    await this.kkv.set(PREFERENCES_MODULE, key, value);
  }

  private async getBooleanPref(name: BooleanPrefName): Promise<Result<boolean, AppError>> {
    const { key, defaultValue } = BOOLEAN_PREFS[name];
    const raw = await this.getPreference(key);
    if (!raw.ok) return Result.err(raw.error);
    if (raw.value === undefined) return Result.ok(defaultValue);
    const parsed = Kkv.parseBoolean(raw.value);
    if (parsed === null)
      return Result.err(new AppError("PREFERENCES_INVALID_VALUE", { detail: `Preference key "${key}" expected boolean, got: ${raw.value}`, key, expectedType: "boolean", actualValue: raw.value }));
    return Result.ok(parsed);
  }

  private async setBooleanPref(name: BooleanPrefName, enabled: boolean): Promise<void> {
    await this.setPreference(BOOLEAN_PREFS[name].key, Kkv.formatBoolean(enabled));
  }

  /** `KKV_NOT_FOUND` 幂等归一为成功；其余 KKV 失败经 `Result.err` 原样接力。 */
  private async resetBooleanPref(name: BooleanPrefName): Promise<Result<void, AppError>> {
    const deleted = await this.kkv.delete(PREFERENCES_MODULE, BOOLEAN_PREFS[name].key);
    if (!deleted.ok && !isAppError(deleted.error, "KKV_NOT_FOUND")) return deleted;
    return Result.ok(undefined);
  }
}
