/**
 * Built-in default events configuration when KKV is unset.
 *
 * @module domain/events-config/logic/default-events
 */

import type { EventsConfig } from "../model/events-config.js";
import { EVENT_SESSION_COMPACTION_REQUESTED } from "@/domain/events/model/event-types.js";

/** Factory default: parallel hide depth 6+ and refresh macros on compaction. */
export const DEFAULT_EVENTS_CONFIG: EventsConfig = {
  schemaVersion: 1,
  events: {
    [EVENT_SESSION_COMPACTION_REQUESTED]: {
      mode: "parallel",
      actions: [
        {
          type: "hide-message",
          params: { startDepth: 6 },
        },
        { type: "refresh-macros", params: {} },
      ],
    },
  },
};
