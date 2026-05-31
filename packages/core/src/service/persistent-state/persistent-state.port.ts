/**
 * Workspace pointer persistence port (KKV module `nm-workspace-state`).
 *
 * @module service/persistent-state/persistent-state.port
 */

/**
 * v1 frozen workspace pointers: current project, session, provider, and model.
 *
 * @remarks Missing keys are represented as `undefined`; not read from legacy `global-config`.
 */
export interface PersistentState {
  getCurrentProjectId(): Promise<string | undefined>;
  setCurrentProjectId(id: string): Promise<void>;
  resetCurrentProjectId(): Promise<void>;

  getCurrentSessionId(): Promise<string | undefined>;
  setCurrentSessionId(id: string): Promise<void>;
  resetCurrentSessionId(): Promise<void>;

  getCurrentProviderId(): Promise<string | undefined>;
  setCurrentProviderId(id: string): Promise<void>;
  resetCurrentProviderId(): Promise<void>;

  getCurrentModelId(): Promise<string | undefined>;
  setCurrentModelId(id: string): Promise<void>;
  resetCurrentModelId(): Promise<void>;

  getCurrentRegexGroupId(): Promise<string | undefined>;
  setCurrentRegexGroupId(id: string): Promise<void>;
  resetCurrentRegexGroupId(): Promise<void>;

  getCurrentAgentId(): Promise<string | undefined>;
  setCurrentAgentId(id: string): Promise<void>;
  resetCurrentAgentId(): Promise<void>;
}
