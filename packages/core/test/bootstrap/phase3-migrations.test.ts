import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import { createKkvService } from "@novel-master/core/kkv";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("Phase 3 bootstrap migrations", () => {
  it("adds vfs_entry.entry_kind on legacy table without the column", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await conn.execute(`
      CREATE TABLE vfs_entry (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        mtime_ms INTEGER NOT NULL,
        storage_kind TEXT NOT NULL DEFAULT 'inline',
        external_uri TEXT
      )
    `);
    await conn.execute(
      "INSERT INTO vfs_entry (path, content, mtime_ms) VALUES ('/a.txt', 'hi', 1)",
    );

    await bootstrapNovelMaster(conn);

    const cols = await conn.query<{ name: string }>(
      "SELECT name FROM pragma_table_info('vfs_entry')",
    );
    assert.ok(cols.some((c) => c.name === "entry_kind"));
    const rows = await conn.query<{ entry_kind: string }>(
      "SELECT entry_kind FROM vfs_entry WHERE path = '/a.txt'",
    );
    assert.equal(rows[0]?.entry_kind, "file");
    await conn.close();
  });

  it("backfills worktree_dir_rule fill_policy full to hidden", async () => {
    const ctx = await openNovelMasterTestConnection();
    await bootstrapNovelMaster(ctx.conn);
    await ctx.conn.execute(
      `INSERT INTO worktree_dir_rule (
        scope_key, logical_path, rule_enabled, sort_field, sort_order,
        head_count, tail_count, fill_policy
      ) VALUES ('global', '/legacy', 1, 'name', 'asc', 0, 0, 'full')`,
    );

    await bootstrapNovelMaster(ctx.conn);

    const rows = await ctx.conn.query<{ fill_policy: string }>(
      "SELECT fill_policy FROM worktree_dir_rule WHERE logical_path = '/legacy'",
    );
    assert.equal(rows[0]?.fill_policy, "hidden");
    await ctx.conn.close();
  });

  it("T1: drops agent_definition legacy model and runtime_json columns", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await conn.execute(`
      CREATE TABLE agent_definition (
        agent_id TEXT PRIMARY KEY,
        model TEXT,
        runtime_json TEXT,
        prompts_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `);
    await conn.execute(
      `INSERT INTO agent_definition (
        agent_id, model, runtime_json, prompts_json, created_at_ms, updated_at_ms
      ) VALUES ('legacy', 'old/model', '{"maxSteps":1}', '{}', 1, 1)`,
    );

    await bootstrapNovelMaster(conn);

    const cols = await conn.query<{ name: string }>(
      "SELECT name FROM pragma_table_info('agent_definition')",
    );
    const names = cols.map((c) => c.name);
    assert.ok(!names.includes("model"));
    assert.ok(!names.includes("runtime_json"));
    const rows = await conn.query<{ agent_id: string; prompts_json: string }>(
      "SELECT agent_id, prompts_json FROM agent_definition WHERE agent_id = 'legacy'",
    );
    assert.equal(rows[0]?.agent_id, "legacy");
    assert.equal(rows[0]?.prompts_json, "{}");
    await conn.close();
  });

  it("purges legacy global-config KKV rows", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("global-config", "currentProjectId", "legacy");
    await bootstrapNovelMaster(ctx.conn);

    const keys = await kkv.listKeys("global-config");
    assert.deepEqual(keys, []);
    await ctx.conn.close();
  });

  it("purges retired preference keys on bootstrap", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "chat.showFullToolParams", "true");
    await kkv.set("nm-preferences", "session-fs.checkpointRetention", "250");
    await kkv.set("nm-mobile-ui", "checkpointRetention", "99");
    await bootstrapNovelMaster(ctx.conn);

    const prefKeys = await kkv.listKeys("nm-preferences");
    assert.ok(!prefKeys.includes("chat.showFullToolParams"));
    assert.ok(!prefKeys.includes("session-fs.checkpointRetention"));
    const mobileUiKeys = await kkv.listKeys("nm-mobile-ui");
    assert.ok(!mobileUiKeys.includes("checkpointRetention"));
    await ctx.conn.close();
  });
});
