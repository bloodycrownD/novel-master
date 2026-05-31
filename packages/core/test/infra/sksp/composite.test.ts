import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCompositeSecretStore } from "../../../src/infra/sksp/impl/composite-secret-store.js";
import type { SecretStore } from "../../../src/infra/sksp/ports/secret-store.port.js";

function memoryStore(initial?: Record<string, string>): SecretStore {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async has(ref) {
      return map.has(ref);
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}

describe("createCompositeSecretStore", () => {
  it("prefers env over db on get", async () => {
    const db = memoryStore({ "provider/openai/apiKey": "db-key" });
    const env = {
      async get(ref: string) {
        if (ref === "provider/openai/apiKey") {
          return "env-key";
        }
        return null;
      },
      async has(ref: string) {
        const v = await this.get(ref);
        return v !== null && v !== "";
      },
    };
    const composite = createCompositeSecretStore({ db, env });
    assert.equal(await composite.get("provider/openai/apiKey"), "env-key");
  });

  it("falls back to db when env returns null", async () => {
    const db = memoryStore({ "provider/openai/apiKey": "db-key" });
    const env = {
      async get() {
        return null;
      },
      async has() {
        return false;
      },
    };
    const composite = createCompositeSecretStore({ db, env });
    assert.equal(await composite.get("provider/openai/apiKey"), "db-key");
  });

  it("set/delete only touch db", async () => {
    const db = memoryStore();
    const env = {
      async get() {
        return "env-only";
      },
      async has() {
        return true;
      },
    };
    const composite = createCompositeSecretStore({ db, env });
    await composite.set("provider/x/apiKey", "stored");
    assert.equal(await db.get("provider/x/apiKey"), "stored");
    assert.equal(await composite.get("provider/x/apiKey"), "env-only");
  });
});
