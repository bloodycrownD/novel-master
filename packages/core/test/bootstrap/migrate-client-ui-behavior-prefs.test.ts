import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KkvError } from "@novel-master/core";
import type { KkvService } from "@novel-master/core/kkv";
import {
  migrateClientUiBehaviorPrefsToPreferences,
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
  PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
  PREFERENCES_MODULE,
} from "@novel-master/core";

function createMemoryKkv(): KkvService {
  const data = new Map<string, string>();
  const compound = (module: string, key: string) => `${module}\0${key}`;

  return {
    async listKeys(module: string) {
      const prefix = `${module}\0`;
      return [...data.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async get(module: string, key: string) {
      const v = data.get(compound(module, key));
      if (v === undefined) {
        throw new KkvError("NOT_FOUND", "missing", { module, key });
      }
      return v;
    },
    async set(module: string, key: string, value: string) {
      data.set(compound(module, key), value);
    },
    async delete(module: string, key: string) {
      const k = compound(module, key);
      if (!data.has(k)) {
        throw new KkvError("NOT_FOUND", "missing", { module, key });
      }
      data.delete(k);
    },
  };
}

async function tryGet(
  kkv: KkvService,
  module: string,
  key: string,
): Promise<string | undefined> {
  try {
    return await kkv.get(module, key);
  } catch (error) {
    if (error instanceof KkvError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

describe("migrateClientUiBehaviorPrefsToPreferences", () => {
  it("C4: old-only → new has value + old deleted", async () => {
    const kkv = createMemoryKkv();
    await kkv.set("nm-mobile-ui", "llmStream", "false");
    await kkv.set("nm-mobile-ui", "showFullToolParams", "true");
    await kkv.set("nm-mobile-ui", "checkpointRetention", "250");

    await migrateClientUiBehaviorPrefsToPreferences(kkv);

    assert.equal(
      await tryGet(kkv, PREFERENCES_MODULE, PREF_KEY_CHAT_LLM_STREAM),
      "false",
    );
    assert.equal(
      await tryGet(kkv, PREFERENCES_MODULE, PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS),
      "true",
    );
    assert.equal(
      await tryGet(
        kkv,
        PREFERENCES_MODULE,
        PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
      ),
      "250",
    );
    assert.equal(await tryGet(kkv, "nm-mobile-ui", "llmStream"), undefined);
    assert.equal(
      await tryGet(kkv, "nm-mobile-ui", "showFullToolParams"),
      undefined,
    );
    assert.equal(
      await tryGet(kkv, "nm-mobile-ui", "checkpointRetention"),
      undefined,
    );
  });

  it("C5: new already exists → old deleted, new unchanged", async () => {
    const kkv = createMemoryKkv();
    await kkv.set("nm-mobile-ui", "llmStream", "false");
    await kkv.set(PREFERENCES_MODULE, PREF_KEY_CHAT_LLM_STREAM, "true");

    await migrateClientUiBehaviorPrefsToPreferences(kkv);

    assert.equal(
      await tryGet(kkv, PREFERENCES_MODULE, PREF_KEY_CHAT_LLM_STREAM),
      "true",
    );
    assert.equal(await tryGet(kkv, "nm-mobile-ui", "llmStream"), undefined);
  });

  it("C6: after migration list includes copied new keys", async () => {
    const kkv = createMemoryKkv();
    await kkv.set("nm-desktop-ui", "llmStream", "false");

    await migrateClientUiBehaviorPrefsToPreferences(kkv);

    const keys = await kkv.listKeys(PREFERENCES_MODULE);
    assert.deepEqual(keys.sort(), [PREF_KEY_CHAT_LLM_STREAM]);
  });

  it("no-op when old keys absent", async () => {
    const kkv = createMemoryKkv();
    await migrateClientUiBehaviorPrefsToPreferences(kkv);
    assert.deepEqual(await kkv.listKeys(PREFERENCES_MODULE), []);
  });

  it("desktop old key migrates when mobile absent", async () => {
    const kkv = createMemoryKkv();
    await kkv.set("nm-desktop-ui", "llmStream", "false");

    await migrateClientUiBehaviorPrefsToPreferences(kkv);

    assert.equal(
      await tryGet(kkv, PREFERENCES_MODULE, PREF_KEY_CHAT_LLM_STREAM),
      "false",
    );
    assert.equal(await tryGet(kkv, "nm-desktop-ui", "llmStream"), undefined);
  });
});
