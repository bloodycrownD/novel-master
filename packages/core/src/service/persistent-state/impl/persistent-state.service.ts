/**
 * Default {@link PersistentState} backed by internal KKV.
 *
 * @module service/persistent-state/impl/persistent-state.service
 */

import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { PersistentState } from "../persistent-state.port.js";

/** KKV module for CLI/workspace pointers (not `global-config`). */
const MODULE = "nm-workspace-state";

const KEY_CURRENT_PROJECT_ID = "currentProjectId";
const KEY_CURRENT_SESSION_ID = "currentSessionId";
const KEY_CURRENT_PROVIDER_ID = "currentProviderId";
const KEY_CURRENT_MODEL_ID = "currentModelId";
const KEY_CURRENT_REGEX_GROUP_ID = "currentRegexGroupId";
const KEY_CURRENT_AGENT_ID = "currentAgentId";

export class DefaultPersistentState implements PersistentState {
  constructor(private readonly kkv: KkvService) {}

  getCurrentProjectId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_PROJECT_ID);
  }

  setCurrentProjectId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_PROJECT_ID, id);
  }

  resetCurrentProjectId(): Promise<void> {
    return this.reset(KEY_CURRENT_PROJECT_ID);
  }

  getCurrentSessionId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_SESSION_ID);
  }

  setCurrentSessionId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_SESSION_ID, id);
  }

  resetCurrentSessionId(): Promise<void> {
    return this.reset(KEY_CURRENT_SESSION_ID);
  }

  getCurrentProviderId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_PROVIDER_ID);
  }

  setCurrentProviderId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_PROVIDER_ID, id);
  }

  resetCurrentProviderId(): Promise<void> {
    return this.reset(KEY_CURRENT_PROVIDER_ID);
  }

  getCurrentModelId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_MODEL_ID);
  }

  setCurrentModelId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_MODEL_ID, id);
  }

  resetCurrentModelId(): Promise<void> {
    return this.reset(KEY_CURRENT_MODEL_ID);
  }

  getCurrentRegexGroupId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_REGEX_GROUP_ID);
  }

  setCurrentRegexGroupId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_REGEX_GROUP_ID, id);
  }

  resetCurrentRegexGroupId(): Promise<void> {
    return this.reset(KEY_CURRENT_REGEX_GROUP_ID);
  }

  getCurrentAgentId(): Promise<string | undefined> {
    return this.get(KEY_CURRENT_AGENT_ID);
  }

  setCurrentAgentId(id: string): Promise<void> {
    return this.set(KEY_CURRENT_AGENT_ID, id);
  }

  resetCurrentAgentId(): Promise<void> {
    return this.reset(KEY_CURRENT_AGENT_ID);
  }

  private async get(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, key);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }

  private async set(key: string, value: string): Promise<void> {
    await this.kkv.set(MODULE, key, value);
  }

  private async reset(key: string): Promise<void> {
    try {
      await this.kkv.delete(MODULE, key);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }
}
