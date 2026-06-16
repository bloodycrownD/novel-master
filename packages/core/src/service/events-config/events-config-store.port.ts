/**
 * Events configuration KKV store port.
 *
 * @module service/events-config/events-config-store.port
 */

import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import type { StoredConfigHealth } from "@/config-forms/stored-config-validity/types.js";

export interface EventsConfigStore {
  /** Persisted config or built-in default when unset. */
  getConfig(): Promise<EventsConfig>;
  /** KKV 原始 wire JSON（未 strict decode），无配置时返回默认 wire。 */
  getRawWire(): Promise<unknown>;
  /** 对当前存储 wire 做有效性判定（无配置时评估内置默认，应为 valid）。 */
  assessStored(): Promise<StoredConfigHealth<EventsConfig>>;
  setConfig(config: EventsConfig): Promise<void>;
  clearConfig(): Promise<void>;
}
