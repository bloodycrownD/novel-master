import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster } from "@novel-master/core";

import { createProviderServices } from "@novel-master/core/provider";
import { createKkvService } from "@novel-master/core/kkv";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { open } from "../../src/infra/tdbc/index.js";
import { KKV_SCHEMA_STATEMENTS } from "../../src/bootstrap/kkv/kkv-schema.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
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

describe("model-context-settings bootstrap migrations", () => {
  it("purges nm-model-sampling, drops llm_model_suggestion, backfills settings_json", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });

    await conn.execute(
      `CREATE TABLE llm_provider (
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL,
        base_url TEXT NOT NULL,
        display_name TEXT,
        secret_ref TEXT,
        headers_json TEXT NOT NULL DEFAULT '{}',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )`,
      [],
    );
    await conn.execute(
      `CREATE TABLE llm_model_suggestion (
        provider_id TEXT NOT NULL,
        vendor_model_id TEXT NOT NULL,
        display_name TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        last_seen_at_ms INTEGER NOT NULL,
        PRIMARY KEY (provider_id, vendor_model_id)
      )`,
      [],
    );
    await conn.execute(
      `CREATE TABLE llm_saved_model (
        provider_id TEXT NOT NULL,
        vendor_model_id TEXT NOT NULL,
        display_name TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (provider_id, vendor_model_id)
      )`,
      [],
    );
    await conn.execute(
      `INSERT INTO llm_provider VALUES ('openai','openai','http://x',NULL,NULL,'{}',1,0,0)`,
      [],
    );
    await conn.execute(
      `INSERT INTO llm_saved_model VALUES ('openai','claude-3-5-sonnet',NULL,0,0)`,
      [],
    );
    await conn.execute(
      `INSERT INTO llm_saved_model VALUES ('openai','unknown-model',NULL,0,0)`,
      [],
    );

    for (const sql of KKV_SCHEMA_STATEMENTS) {
      await conn.execute(sql, []);
    }
    const kkv = createKkvService(conn);
    await kkv.set("nm-model-sampling", "profile/openai/old", '{"enabled":true}');

    await bootstrapNovelMaster(conn);

    const samplingKeys = await kkv.listKeys("nm-model-sampling");
    assert.equal(samplingKeys.length, 0);

    const tables = await conn.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='llm_model_suggestion'",
    );
    assert.equal(tables.length, 0);

    const bundle = createProviderServices(conn, memorySecretStore());
    const claude = await bundle.providerModels.getSaved("openai/claude-3-5-sonnet");
    const unknown = await bundle.providerModels.getSaved("openai/unknown-model");
    assert.equal(claude?.settings.contextWindowTokens, 200_000);
    assert.equal(unknown?.settings.contextWindowTokens, 128_000);

    await conn.close();
  });
});
