/**
 * Workspace pointer persistence port (KKV module `nm-workspace-state`).
 *
 * @module service/persistent-state/persistent-state.port
 */

/**
 * v1 frozen workspace pointers: current project, session, provider, and model.
 *
 * @remarks Missing keys are represented as `undefined`; not read from legacy `global-config`.
 * Mobile/desktop apps treat {@link PersistentState.getCurrentModelId} as the product authority
 * for LLM selection and do **not** call {@link PersistentState.setCurrentProviderId}.
 */
export interface PersistentState {
  getCurrentProjectId(): Promise<string | undefined>;
  setCurrentProjectId(id: string): Promise<void>;
  resetCurrentProjectId(): Promise<void>;

  getCurrentSessionId(): Promise<string | undefined>;
  setCurrentSessionId(id: string): Promise<void>;
  resetCurrentSessionId(): Promise<void>;

  /** CLI-scoped workspace pointer (`nm provider use`); apps may read/reset but do not set. */
  getCurrentProviderId(): Promise<string | undefined>;
  /** CLI-scoped: `nm provider use` only; mobile/desktop must not call. */
  setCurrentProviderId(id: string): Promise<void>;
  resetCurrentProviderId(): Promise<void>;

  getCurrentModelId(): Promise<string | undefined>;
  setCurrentModelId(id: string): Promise<void>;
  resetCurrentModelId(): Promise<void>;

  /**
   * 当前正则分组指针；实体删除由 {@link import("@/service/regex/regex-config.port.js").RegexConfigService} 维护。
   */
  getCurrentRegexGroupId(): Promise<string | undefined>;
  setCurrentRegexGroupId(id: string): Promise<void>;
  resetCurrentRegexGroupId(): Promise<void>;

  /**
   * 当前 Agent 指针；实体删除由 {@link import("@/service/agent/agent-registry.port.js").AgentRegistryService} 维护。
   */
  getCurrentAgentId(): Promise<string | undefined>;
  setCurrentAgentId(id: string): Promise<void>;
  resetCurrentAgentId(): Promise<void>;
}