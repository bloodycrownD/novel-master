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
import { KEY_CURRENT_AGENT_ID, KEY_CURRENT_MODEL_ID, KEY_CURRENT_PROJECT_ID, KEY_CURRENT_PROVIDER_ID, KEY_CURRENT_SESSION_ID, WORKSPACE_STATE_MODULE } from "./workspace-state-keys.js";

const MODULE = WORKSPACE_STATE_MODULE;

/** 工作区指针 SSoT：`invalidatesPromptTokens` 决定 set 后是否丢弃当前会话 API 占用。 */
const STATE_KEYS = {
  currentProjectId: { key: KEY_CURRENT_PROJECT_ID, invalidatesPromptTokens: false },
  currentSessionId: { key: KEY_CURRENT_SESSION_ID, invalidatesPromptTokens: false },
  currentProviderId: { key: KEY_CURRENT_PROVIDER_ID, invalidatesPromptTokens: false },
  currentModelId: { key: KEY_CURRENT_MODEL_ID, invalidatesPromptTokens: true },
  currentAgentId: { key: KEY_CURRENT_AGENT_ID, invalidatesPromptTokens: true },
} as const;

type StateKey = keyof typeof STATE_KEYS;

export class DefaultPersistentState implements PersistentState {
  /**
   * @param kkv 工作区指针存储（`nm-workspace-state`）。
   * @param sessionKkv 会话 KKV：切模型 / 切 Agent 后失效该会话的 API prompt
   *   占用（进程内热层 + `prompt_tokens` 域行双删）。可选——缺省时失效只
   *   退化为清进程内热层，不因装配缺失而报错。
   */
  constructor(private readonly kkv: KkvService, private readonly sessionKkv?: SessionKkvService | null) {}

  getCurrentProjectId(): Promise<Result<string | undefined, AppError>> {
    return this.getPointer("currentProjectId");
  }

  setCurrentProjectId(id: string): Promise<Result<void, AppError>> {
    return this.setPointer("currentProjectId", id);
  }

  resetCurrentProjectId(): Promise<void> {
    return this.resetPointer("currentProjectId");
  }

  getCurrentSessionId(): Promise<Result<string | undefined, AppError>> {
    return this.getPointer("currentSessionId");
  }

  setCurrentSessionId(id: string): Promise<Result<void, AppError>> {
    return this.setPointer("currentSessionId", id);
  }

  resetCurrentSessionId(): Promise<void> {
    return this.resetPointer("currentSessionId");
  }

  getCurrentProviderId(): Promise<Result<string | undefined, AppError>> {
    return this.getPointer("currentProviderId");
  }

  /** nm-style: keep-public — PersistentState 端口方法；CLI `nm provider use` 单点消费（apps 禁调）。 */
  setCurrentProviderId(id: string): Promise<Result<void, AppError>> {
    return this.setPointer("currentProviderId", id);
  }

  resetCurrentProviderId(): Promise<void> {
    return this.resetPointer("currentProviderId");
  }

  getCurrentModelId(): Promise<Result<string | undefined, AppError>> {
    return this.getPointer("currentModelId");
  }

  async setCurrentModelId(id: string): Promise<Result<void, AppError>> {
    const trimmed = id.trim();
    if (trimmed.includes("/")) return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Invalid saved model id (legacy path not accepted): ${id}`, modelId: id }));
    if (!isSavedModelUuidFormat(trimmed)) return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Invalid saved model id (expected UUID): ${id}`, modelId: id }));
    return this.setPointer("currentModelId", trimmed);
  }

  resetCurrentModelId(): Promise<void> {
    return this.resetPointer("currentModelId");
  }

  getCurrentAgentId(): Promise<Result<string | undefined, AppError>> {
    return this.getPointer("currentAgentId");
  }

  setCurrentAgentId(id: string): Promise<Result<void, AppError>> {
    return this.setPointer("currentAgentId", id);
  }

  /** nm-style: keep-public — PersistentState 端口方法；agent 删除链单点消费。 */
  resetCurrentAgentId(): Promise<void> {
    return this.resetPointer("currentAgentId");
  }

  /** `KKV_NOT_FOUND` 归一为 `undefined`，其余 KKV 失败经 `Result.err` 原样接力。 */
  private async getPointer(name: StateKey): Promise<Result<string | undefined, AppError>> {
    const raw = await this.kkv.get(MODULE, STATE_KEYS[name].key);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    return Result.ok(raw.ok ? raw.value : undefined);
  }

  /**
   * 写指针；配置标记 `invalidatesPromptTokens` 时丢弃当前会话陈旧的 API 占用。
   *
   * 双删（进程内热层 + session KKV 行）：只清热层的话，重启后 KKV 里的
   * 旧模型占用会被读回，按 api 口径参与阈值判定（跳掉 heuristic 安全系数）。
   */
  private async setPointer(name: StateKey, value: string): Promise<Result<void, AppError>> {
    await this.kkv.set(MODULE, STATE_KEYS[name].key, value);
    if (!STATE_KEYS[name].invalidatesPromptTokens) return Result.ok(undefined);
    const sessionId = await this.getPointer("currentSessionId");
    if (!sessionId.ok) return Result.err(sessionId.error);
    if (sessionId.value != null) await invalidateSessionApiPromptTokenEntry(this.sessionKkv, sessionId.value);
    return Result.ok(undefined);
  }

  private async resetPointer(name: StateKey): Promise<void> {
    try {
      await this.kkv.delete(MODULE, STATE_KEYS[name].key);
    } catch (error) {
      if (isAppError(error, "KKV_NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }
}
