/**
 * Built-in default events configuration when KKV is unset (UI fallback).
 */
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";

const EVENT_SESSION_COMPACTION_REQUESTED = "session.compaction.requested";

/** 出厂默认：压缩时仅 hide-message。 */
export const DEFAULT_EVENTS_CONFIG: EventsConfig = {
  schemaVersion: 2,
  events: {
    [EVENT_SESSION_COMPACTION_REQUESTED]: [
      {
        type: "hide-message",
        params: { startDepth: 6 },
      },
    ],
  },
};
