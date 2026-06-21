import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DefaultEventsConfigStore } from "../../src/service/events-config/impl/events-config-store.service.js";
import {
  EventsConfigError,
  isEventsConfigError,
} from "../../src/errors/events-config-errors.js";

describe("events config store corrupt JSON", () => {
  it("损坏 JSON 抛 EventsConfigError INVALID_JSON，非 SyntaxError", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get() {
        return "{invalid json";
      },
      async set() {},
      async delete() {},
    });

    await assert.rejects(
      () => store.getConfig(),
      (error: unknown) => {
        assert.notEqual(error instanceof SyntaxError, true);
        return isEventsConfigError(error, "INVALID_JSON");
      },
    );
  });

  it("getRawWire 对损坏 JSON 同样 fail-fast", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get() {
        return "{invalid json";
      },
      async set() {},
      async delete() {},
    });

    await assert.rejects(
      () => store.getRawWire(),
      (error: unknown) => isEventsConfigError(error, "INVALID_JSON"),
    );
  });

  it("schema 不匹配抛 EventsConfigError INVALID_SCHEMA", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get() {
        return '{"schemaVersion":1,"events":{}}';
      },
      async set() {},
      async delete() {},
    });

    await assert.rejects(
      () => store.getConfig(),
      (error: unknown) => {
        assert.ok(error instanceof EventsConfigError || isEventsConfigError(error));
        return isEventsConfigError(error, "INVALID_SCHEMA");
      },
    );
  });
});
