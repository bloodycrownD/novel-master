/**
 * KKV-backed events configuration store (`nm-events`).
 *
 * @module service/events-config/impl/events-config-store.service
 */

import { assessEventsConfigWire } from "@/config-forms/stored-config-validity/assess-events-config-wire.js";
import type { StoredConfigHealth } from "@/config-forms/stored-config-validity/types.js";
import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import { DEFAULT_EVENTS_CONFIG } from "@/domain/events-config/logic/default-events.js";
import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { EventsConfigStore } from "../events-config-store.port.js";

const MODULE = "nm-events";
const KEY_CONFIG = "config";

export class DefaultEventsConfigStore implements EventsConfigStore {
  constructor(private readonly kkv: KkvService) {}

  async getConfig(): Promise<EventsConfig> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return DEFAULT_EVENTS_CONFIG;
    }
    return decode(JSON.parse(raw) as unknown, eventsConfigSchema);
  }

  async getRawWire(): Promise<unknown> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return encode(DEFAULT_EVENTS_CONFIG, eventsConfigSchema);
    }
    return JSON.parse(raw) as unknown;
  }

  async assessStored(): Promise<StoredConfigHealth<EventsConfig>> {
    const wire = await this.getRawWire();
    return assessEventsConfigWire(wire);
  }

  async setConfig(config: EventsConfig): Promise<void> {
    const wire = encode(config, eventsConfigSchema);
    await this.kkv.set(MODULE, KEY_CONFIG, JSON.stringify(wire));
  }

  async clearConfig(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_CONFIG);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }

  private async getRaw(): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, KEY_CONFIG);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }
}
