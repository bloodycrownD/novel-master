/**
 * Events configuration KKV store port.
 *
 * @module service/events-config/events-config-store.port
 */

import type { EventsConfig } from "@/domain/events-config/model/events-config.js";

export interface EventsConfigStore {
  /** Persisted config or built-in default when unset. */
  getConfig(): Promise<EventsConfig>;
  setConfig(config: EventsConfig): Promise<void>;
  clearConfig(): Promise<void>;
}
