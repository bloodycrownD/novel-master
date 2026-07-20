/**
 * core StoredConfigHealth → IPC StoredConfigHealthDto。
 */
import type { StoredConfigHealth } from "@novel-master/core/config-forms/stored-config-validity";
import type { StoredConfigHealthDto } from "../../../../shared/ipc-types.js";

export function toStoredConfigHealthDto<TValue extends object>(
  health: StoredConfigHealth<TValue>,
): StoredConfigHealthDto<TValue> {
  if (health.status === "valid") {
    return { status: "valid", value: health.value };
  }
  return {
    status: "invalid",
    code: health.code,
    message: health.message,
    ...(health.storedSchemaVersion != null
      ? { storedSchemaVersion: health.storedSchemaVersion }
      : {}),
  };
}
