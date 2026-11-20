/**
 * Behavioral preferences port (KKV module `nm-preferences`).
 *
 * @module service/persistent-preferences/persistent-preferences.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/**
 * v1 frozen preferences; v2 extends via explicit typed methods (no raw UI writes).
 *
 * @remarks 读/重置路径的 KKV 已知失败走 `Result.err(AppError)`（`KKV_NOT_FOUND`
 * 已在 impl 归一为默认值/成功）；未知异常仍走 throw。
 */
export interface PersistentPreferences {
  /**
   * LLM chat SSE streaming (default `true` when unset).
   */
  getLlmStreamEnabled(): Promise<Result<boolean, AppError>>;
  setLlmStreamEnabled(enabled: boolean): Promise<void>;
  resetLlmStreamEnabled(): Promise<Result<void, AppError>>;

  /**
   * Subagent session SSE streaming (default `true` when unset).
   */
  getSubagentStreamEnabled(): Promise<Result<boolean, AppError>>;
  setSubagentStreamEnabled(enabled: boolean): Promise<void>;
  resetSubagentStreamEnabled(): Promise<Result<void, AppError>>;

  /** 思考内容进入上下文（未设置时默认 false，对齐 impl getBooleanPref 第二参）。 */
  getThinkingContextEnabled(): Promise<Result<boolean, AppError>>;
  setThinkingContextEnabled(enabled: boolean): Promise<void>;
  resetThinkingContextEnabled(): Promise<Result<void, AppError>>;

  /** User VFS 统一 tool turn（未设置时默认 true）。 */
  getUserVfsUnifiedToolTurn(): Promise<Result<boolean, AppError>>;
  setUserVfsUnifiedToolTurn(enabled: boolean): Promise<void>;
  resetUserVfsUnifiedToolTurn(): Promise<Result<void, AppError>>;

  /** All entries in `nm-preferences`, sorted by key (for `nm preferences list`). */
  list(): Promise<ReadonlyArray<{ key: string; value: string }>>;

  /** Raw preference value (undefined when unset). */
  getPreference(key: string): Promise<Result<string | undefined, AppError>>;
  setPreference(key: string, value: string): Promise<void>;
}
