/**
 * Workspace pointer persistence port (KKV module `nm-workspace-state`).
 *
 * @module service/persistent-state/persistent-state.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/**
 * v1 frozen workspace pointers: current project, session, provider, and model.
 *
 * @remarks Missing keys are represented as `undefined`; not read from legacy `global-config`.
 * Mobile/desktop apps treat {@link PersistentState.getCurrentModelId} as the product authority
 * for LLM selection and do **not** call {@link PersistentState.setCurrentProviderId}.
 * 读指针与 `setCurrentModelId` / `setCurrentAgentId` 的已知失败走
 * `Result.err(AppError)`（`KKV_NOT_FOUND` 已在 impl 归一为 `undefined`）；未知异常仍走 throw。
 */
export interface PersistentState {
  getCurrentProjectId(): Promise<Result<string | undefined, AppError>>;
  setCurrentProjectId(id: string): Promise<void>;
  resetCurrentProjectId(): Promise<void>;

  getCurrentSessionId(): Promise<Result<string | undefined, AppError>>;
  setCurrentSessionId(id: string): Promise<void>;
  resetCurrentSessionId(): Promise<void>;

  /** CLI-scoped workspace pointer (`nm provider use`); apps may read/reset but do not set. */
  getCurrentProviderId(): Promise<Result<string | undefined, AppError>>;
  /** CLI-scoped: `nm provider use` only; mobile/desktop must not call. */
  setCurrentProviderId(id: string): Promise<void>;
  resetCurrentProviderId(): Promise<void>;

  getCurrentModelId(): Promise<Result<string | undefined, AppError>>;
  setCurrentModelId(id: string): Promise<Result<void, AppError>>;
  resetCurrentModelId(): Promise<void>;

  /**
   * 当前 Agent 指针；实体删除由 {@link import("../../service/agent/agent-registry.port.js").AgentRegistryService} 维护。
   */
  getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
  setCurrentAgentId(id: string): Promise<Result<void, AppError>>;
  resetCurrentAgentId(): Promise<void>;
}
