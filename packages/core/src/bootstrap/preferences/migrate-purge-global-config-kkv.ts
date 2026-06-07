/**
 * Purges legacy `global-config` KKV module rows superseded by PersistentState/Preferences.
 *
 * WHY: new code never reads `global-config`; stale rows are harmless but confuse
 * `nm preferences list` / DB inspection — bootstrap deletes them once per upgrade.
 *
 * @module bootstrap/preferences/migrate-purge-global-config-kkv
 */

import type { KkvService } from "@/service/kkv/kkv.port.js";

const LEGACY_GLOBAL_CONFIG_MODULE = "global-config";

/** Deletes all keys under legacy `global-config` module (idempotent). */
export async function migratePurgeGlobalConfigKkv(
  kkv: KkvService,
): Promise<void> {
  const keys = await kkv.listKeys(LEGACY_GLOBAL_CONFIG_MODULE);
  for (const key of keys) {
    await kkv.delete(LEGACY_GLOBAL_CONFIG_MODULE, key);
  }
}
