/**
 * KKV-backed events configuration store (`nm-events`).
 *
 * @module service/events-config/impl/events-config-store.service
 */

import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import { DEFAULT_EVENTS_CONFIG } from "@/domain/events-config/logic/default-events.js";
import { KkvError } from "@/errors/kkv-errors.js";
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
    try {
      return decode(JSON.parse(raw) as unknown, eventsConfigSchema);
    } catch {
      return DEFAULT_EVENTS_CONFIG;
    }
  }

  async setConfig(config: EventsConfig): Promise<void> {
    const wire = encode(config, eventsConfigSchema);
    await this.kkv.set(MODULE, KEY_CONFIG, JSON.stringify(wire));
  }

  async clearConfig(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_CONFIG);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }

  private async getRaw(): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, KEY_CONFIG);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }
}
