/**
 * Built-in default events configuration when KKV is unset.
 *
 * @module domain/events-config/logic/default-events
 */

import type { EventsConfig } from "../model/events-config.js";
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@/domain/events/model/event-types.js";

/**
 * 出厂默认：压缩时仅 hide-message。
 */
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
