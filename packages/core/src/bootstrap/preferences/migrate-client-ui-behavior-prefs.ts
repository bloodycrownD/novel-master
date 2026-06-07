/**
 * Inline migration: Client UI behavior keys → `nm-preferences` v2 keys.
 *
 * @module bootstrap/preferences/migrate-client-ui-behavior-prefs
 */

import { isKkvError } from "@/errors/kkv-errors.js";
import {
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
  PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
  PREFERENCES_MODULE,
} from "@/service/persistent-preferences/impl/preference-keys.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";

/** Semantic oldKey → newKey; fromModule allows mobile and desktop Client UI namespaces. */
export type ClientUiPrefMigration = {
  readonly fromModule: string;
  readonly fromKey: string;
  readonly toKey: string;
};

/** Deterministic order: mobile entries before desktop for same toKey. */
export const CLIENT_UI_BEHAVIOR_PREF_MIGRATIONS: readonly ClientUiPrefMigration[] =
  [
    {
      fromModule: "nm-mobile-ui",
      fromKey: "llmStream",
      toKey: PREF_KEY_CHAT_LLM_STREAM,
    },
    {
      fromModule: "nm-mobile-ui",
      fromKey: "showFullToolParams",
      toKey: PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
    },
    {
      fromModule: "nm-mobile-ui",
      fromKey: "checkpointRetention",
      toKey: PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
    },
    {
      fromModule: "nm-desktop-ui",
      fromKey: "llmStream",
      toKey: PREF_KEY_CHAT_LLM_STREAM,
    },
    {
      fromModule: "nm-desktop-ui",
      fromKey: "showFullToolParams",
      toKey: PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
    },
    {
      fromModule: "nm-desktop-ui",
      fromKey: "checkpointRetention",
      toKey: PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
    },
  ];

async function tryGet(
  kkv: KkvService,
  module: string,
  key: string,
): Promise<string | undefined> {
  try {
    return await kkv.get(module, key);
  } catch (error) {
    if (isKkvError(error, "NOT_FOUND")) {
      return undefined;
    }
    throw error;
  }
}

async function tryDelete(
  kkv: KkvService,
  module: string,
  key: string,
): Promise<void> {
  try {
    await kkv.delete(module, key);
  } catch (error) {
    if (isKkvError(error, "NOT_FOUND")) {
      return;
    }
    throw error;
  }
}

/**
 * Copies Client UI behavior prefs into `nm-preferences` when new key is absent,
 * then deletes the old Client UI key if it existed.
 */
export async function migrateClientUiBehaviorPrefsToPreferences(
  kkv: KkvService,
): Promise<void> {
  for (const { fromModule, fromKey, toKey } of CLIENT_UI_BEHAVIOR_PREF_MIGRATIONS) {
    const oldValue = await tryGet(kkv, fromModule, fromKey);
    if (oldValue === undefined) {
      continue;
    }
    const newValue = await tryGet(kkv, PREFERENCES_MODULE, toKey);
    if (newValue === undefined) {
      await kkv.set(PREFERENCES_MODULE, toKey, oldValue);
    }
    await tryDelete(kkv, fromModule, fromKey);
  }
}
