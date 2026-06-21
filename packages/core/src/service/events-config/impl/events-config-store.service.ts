/**
 * KKV-backed events configuration store (`nm-events`).
 *
 * @module service/events-config/impl/events-config-store.service
 */

import { assessEventsConfigWire } from "@/config-forms/stored-config-validity/assess-events-config-wire.js";
import type { StoredConfigHealth } from "@/config-forms/stored-config-validity/types.js";
import { decode } from "@/infra/serialization/decode.js";
import { encode } from "@/infra/serialization/encode.js";
import { parseKkvJsonDocument } from "@/infra/kkv/logic/parse-kkv-json-document.js";
import { eventsConfigSchema } from "@/domain/events-config/model/events-config.schema.js";
import type { EventsConfig } from "@/domain/events-config/model/events-config.js";
import { DEFAULT_EVENTS_CONFIG } from "@/domain/events-config/logic/default-events.js";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";
import {
  eventsConfigInvalidJson,
  eventsConfigInvalidSchema,
} from "@/errors/events-config-errors.js";
import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { EventsConfigStore } from "../events-config-store.port.js";

const MODULE = "nm-events";
const KEY_CONFIG = "config";

function rethrowParseError(error: unknown): never {
  if (error instanceof SyntaxError) {
    throw eventsConfigInvalidJson(
      `invalid JSON in ${MODULE}/${KEY_CONFIG}: ${error.message}`,
    );
  }
  if (error instanceof ConfigDecodeError && error.code === "INVALID_SCHEMA") {
    throw eventsConfigInvalidSchema(error.message);
  }
  throw error;
}

function parseEventsConfigWire(raw: string): EventsConfig {
  try {
    return parseKkvJsonDocument(raw, (parsed) =>
      decode(parsed, eventsConfigSchema),
    );
  } catch (error) {
    rethrowParseError(error);
  }
}

function parseEventsConfigJson(raw: string): unknown {
  try {
    return parseKkvJsonDocument(raw, (parsed) => parsed);
  } catch (error) {
    rethrowParseError(error);
  }
}

export class DefaultEventsConfigStore implements EventsConfigStore {
  constructor(private readonly kkv: KkvService) {}

  async getConfig(): Promise<EventsConfig> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return DEFAULT_EVENTS_CONFIG;
    }
    return parseEventsConfigWire(raw);
  }

  async getRawWire(): Promise<unknown> {
    const raw = await this.getRaw();
    if (raw === undefined) {
      return encode(DEFAULT_EVENTS_CONFIG, eventsConfigSchema);
    }
    return parseEventsConfigJson(raw);
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
