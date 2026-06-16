/**
 * 事件配置 wire 有效性判定。
 *
 * @module config-forms/stored-config-validity/assess-events-config-wire
 */

import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import { decode } from "@/infra/serialization/decode.js";
import type { StoredConfigHealth, StoredConfigInvalidCode } from "./types.js";
import { CURRENT_EVENTS_SCHEMA_VERSION } from "./types.js";

function invalid(
  code: StoredConfigInvalidCode,
  message: string,
  storedSchemaVersion?: number,
): StoredConfigHealth<EventsConfig> {
  return {
    status: "invalid",
    code,
    message,
    ...(storedSchemaVersion != null ? { storedSchemaVersion } : {}),
  };
}

function isV1EventEntry(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return "parallel" in record || "sequential" in record;
}

function hasV1EventShapes(events: unknown): boolean {
  if (events == null || typeof events !== "object" || Array.isArray(events)) {
    return false;
  }
  for (const value of Object.values(events as Record<string, unknown>)) {
    if (isV1EventEntry(value)) {
      return true;
    }
  }
  return false;
}

function isRemovedFeatureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("refresh-macros") || lower.includes("unknown action");
}

/**
 * 将事件配置 wire 判定为 valid / invalid。
 * 不做自动迁移；无效 wire 由 UI 引导用户重置。
 */
export function assessEventsConfigWire(raw: unknown): StoredConfigHealth<EventsConfig> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("broken_wire", "事件配置 wire 须为对象");
  }

  const doc = raw as Record<string, unknown>;
  const schemaVersion = doc.schemaVersion;
  if (schemaVersion !== CURRENT_EVENTS_SCHEMA_VERSION) {
    const storedSchemaVersion =
      typeof schemaVersion === "number" ? schemaVersion : undefined;
    return invalid(
      "outdated_version",
      `事件配置 schemaVersion 须为 ${CURRENT_EVENTS_SCHEMA_VERSION}`,
      storedSchemaVersion,
    );
  }

  if (hasV1EventShapes(doc.events)) {
    return invalid(
      "outdated_version",
      "事件配置仍为 v1 parallel/sequential 形态",
      CURRENT_EVENTS_SCHEMA_VERSION,
    );
  }

  try {
    const value = decode(raw, eventsConfigSchema);
    return { status: "valid", value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRemovedFeatureMessage(message)) {
      return invalid("removed_feature", message);
    }
    return invalid("broken_wire", message);
  }
}
