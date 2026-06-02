import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DefaultEventsConfigStore } from "../../src/service/events-config/impl/events-config-store.service.js";
import { kkvNotFound } from "../../src/errors/kkv-errors.js";

describe("events config store", () => {
  it("returns defaults when config key is missing", async () => {
    const store = new DefaultEventsConfigStore({
      async listKeys() {
        return [];
      },
      async get(module, key) {
        throw kkvNotFound(module, key);
      },
      async set() {},
      async delete() {},
    });

    const config = await store.getConfig();
    assert.equal(config.schemaVersion, 2);
  });

  it("throws when persisted config is invalid", async () => {
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

    await assert.rejects(async () => {
      await store.getConfig();
    });
  });
});
