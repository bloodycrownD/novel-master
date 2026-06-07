/**
 * Purges retired preference keys and leftover Client UI copies.
 *
 * `chat.showFullToolParams` and `session-fs.checkpointRetention` were removed
 * from the product surface; bootstrap deletes any persisted values so CLI/UI
 * cannot resurrect dead settings.
 *
 * @module bootstrap/preferences/migrate-purge-removed-preference-keys
 */

import { isKkvError } from "@/errors/kkv-errors.js";
import { PREFERENCES_MODULE } from "@/service/persistent-preferences/impl/preference-keys.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";

/** Retired `nm-preferences` keys (no longer exposed via PersistentPreferences). */
const RETIRED_PREFERENCE_KEYS = [
  "chat.showFullToolParams",
  "session-fs.checkpointRetention",
] as const;

/** Retired Client UI keys that should never be re-migrated. */
const RETIRED_CLIENT_UI_ENTRIES: ReadonlyArray<{
  readonly module: string;
  readonly key: string;
}> = [
  { module: "nm-mobile-ui", key: "showFullToolParams" },
  { module: "nm-mobile-ui", key: "checkpointRetention" },
  { module: "nm-desktop-ui", key: "showFullToolParams" },
  { module: "nm-desktop-ui", key: "checkpointRetention" },
];

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

/** Idempotent purge of removed preference and Client UI keys. */
export async function migratePurgeRemovedPreferenceKeys(
  kkv: KkvService,
): Promise<void> {
  for (const key of RETIRED_PREFERENCE_KEYS) {
    await tryDelete(kkv, PREFERENCES_MODULE, key);
  }
  for (const { module, key } of RETIRED_CLIENT_UI_ENTRIES) {
    await tryDelete(kkv, module, key);
  }
}
