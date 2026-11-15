/**
 * Default {@link PersistentState} backed by internal KKV.
 *
 * @module service/persistent-state/impl/persistent-state.service
 */

import { isSavedModelUuidFormat } from "@/domain/provider/logic/assert-saved-model-uuid.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { invalidateSessionApiPromptTokenEntry } from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { PersistentState } from "../persistent-state.port.js";
import {
  KEY_CURRENT_AGENT_ID,
  KEY_CURRENT_MODEL_ID,
  KEY_CURRENT_PROJECT_ID,
  KEY_CURRENT_PROVIDER_ID,
  KEY_CURRENT_SESSION_ID,
  WORKSPACE_STATE_MODULE,
} from "./workspace-state-keys.js";

const MODULE = WORKSPACE_STATE_MODULE;

export class DefaultPersistentState implements PersistentState {
  /**
   * @param kkv 工作区指针存储（`nm-workspace-state`）。
   * @param sessionKkv 会话 KKV：切模型 / 切 Agent 后失效该会话的 API prompt
   *   占用（进程内热层 + `prompt_tokens` 域行双删）。可选——缺省时失效只
   *   退化为清进程内热层，不因装配缺失而报错。
   */
  constructor(
    private readonly kkv: KkvService,
    private readonly sessionKkv?: SessionKkvService | null
  ) {}

  getCurrentProjectId(): Promise<Result<string | undefined, AppError>> {
    return this.get(KEY_CURRENT_PROJECT_ID);
  }

  setCurrentProjectId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_PROJECT_ID, id);
  }

  resetCurrentProjectId(): Promise<void> {
    return this.reset(KEY_CURRENT_PROJECT_ID);
  }

  getCurrentSessionId(): Promise<Result<string | undefined, AppError>> {
    return this.get(KEY_CURRENT_SESSION_ID);
  }

  setCurrentSessionId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_SESSION_ID, id);
  }

  resetCurrentSessionId(): Promise<void> {
    return this.reset(KEY_CURRENT_SESSION_ID);
  }

  getCurrentProviderId(): Promise<Result<string | undefined, AppError>> {
    return this.get(KEY_CURRENT_PROVIDER_ID);
  }

  setCurrentProviderId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_PROVIDER_ID, id);
  }

  resetCurrentProviderId(): Promise<void> {
    return this.reset(KEY_CURRENT_PROVIDER_ID);
  }

  getCurrentModelId(): Promise<Result<string | undefined, AppError>> {
    return this.get(KEY_CURRENT_MODEL_ID);
  }

  async setCurrentModelId(id: string): Promise<Result<void, AppError>> {
    const trimmed = id.trim();
    if (trimmed.includes("/")) return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Invalid saved model id (legacy path not accepted): ${id}`, modelId: id }));
    if (!isSavedModelUuidFormat(trimmed)) return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Invalid saved model id (expected UUID): ${id}`, modelId: id }));
    return this.setAndInvalidatePromptTokenCache(KEY_CURRENT_MODEL_ID, trimmed);
  }

  resetCurrentModelId(): Promise<void> {
    return this.reset(KEY_CURRENT_MODEL_ID);
  }

  getCurrentAgentId(): Promise<Result<string | undefined, AppError>> {
    return this.get(KEY_CURRENT_AGENT_ID);
  }

  setCurrentAgentId(id: string): Promise<Result<void, AppError>> {
    return this.setAndInvalidatePromptTokenCache(KEY_CURRENT_AGENT_ID, id);
  }

  resetCurrentAgentId(): Promise<void> {
    return this.reset(KEY_CURRENT_AGENT_ID);
  }

  /** `KKV_NOT_FOUND` 归一为 `undefined`，其余 KKV 失败经 `Result.err` 原样接力。 */
  private async get(key: string): Promise<Result<string | undefined, AppError>> {
    const raw = await this.kkv.get(MODULE, key);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    return Result.ok(raw.ok ? raw.value : undefined);
  }

  private async set(key: string, value: string): Promise<void> {
    await this.kkv.set(MODULE, key, value);
  }

  /**
   * 切换模型 / Agent 成功后，丢弃当前会话陈旧的 API 占用。
   *
   * 双删（进程内热层 + session KKV 行）：只清热层的话，重启后 KKV 里的
   * 旧模型占用会被读回，按 api 口径参与阈值判定（跳掉 heuristic 安全系数）。
   */
  private async setAndInvalidatePromptTokenCache(key: string, value: string): Promise<Result<void, AppError>> {
    await this.set(key, value);
    const sessionId = await this.getCurrentSessionId();
    if (!sessionId.ok) return Result.err(sessionId.error);
    if (sessionId.value != null) {
      await invalidateSessionApiPromptTokenEntry(this.sessionKkv, sessionId.value);
    }
    return Result.ok(undefined);
  }

  private async reset(key: string): Promise<void> {
    try {
      await this.kkv.delete(MODULE, key);
    } catch (error) {
      if (isAppError(error, "KKV_NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }
}
