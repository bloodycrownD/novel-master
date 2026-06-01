/**
 * Factory for {@link DefaultEventsConfigStore}.
 *
 * @module service/events-config/create-events-config-store
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import { DefaultEventsConfigStore } from "./impl/events-config-store.service.js";
import type { EventsConfigStore } from "./events-config-store.port.js";

export function createEventsConfigStore(conn: TdbcConnection): EventsConfigStore {
  return new DefaultEventsConfigStore(createKkvService(conn));
}
