/**
 * Built-in default events configuration when KKV is unset.
 *
 * @module domain/events-config/logic/default-events
 */

import type { EventsConfig } from "../model/events-config.js";

/** session.compaction.requested 事件名（原由 event-types 常量提供，随事件编排器一并移除）。 */
const SESSION_COMPACTION_REQUESTED = "session.compaction.requested";

/**
 * 出厂默认：压缩时仅 hide-message。
 */
export const DEFAULT_EVENTS_CONFIG: EventsConfig = {
  schemaVersion: 2,
  events: {
    [SESSION_COMPACTION_REQUESTED]: [
      {
        type: "hide-message",
        params: { startDepth: 6 },
      },
    ],
  },
};
