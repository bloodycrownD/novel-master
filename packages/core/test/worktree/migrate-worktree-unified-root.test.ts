import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorktreeService } from "@novel-master/core";
import { migrateWorktreeUnifiedRoot } from "../../src/bootstrap/worktree/migrate-worktree-unified-root.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

async function seedLegacyGlobalDirRule(conn: {
  execute: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
}): Promise<void> {
  await conn.execute(
    `INSERT INTO worktree_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES (
       'global', '/template', 1, 'name', 'asc', 0, 0, 'hidden'
     )`,
  );
  await conn.execute(
    `INSERT INTO worktree_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES (
       'global', '/template/legacy-dir', 1, 'name', 'asc', 0, 0, 'hidden'
     )`,
  );
}

describe("migrateWorktreeUnifiedRoot", () => {
  it("T9: rewrites legacy /template logical paths to unified root", async () => {
    const ctx = await openNovelMasterTestConnection();
    await seedLegacyGlobalDirRule(ctx.conn);
    await migrateWorktreeUnifiedRoot(ctx.conn);

    const wt = createWorktreeService(ctx.conn, { kind: "global" });
    const root = await wt.getDirRule("/");
    assert.ok(root);
    assert.equal(root.logicalPath, "/");
    assert.equal(root.ruleEnabled, true);

    const nested = await wt.getDirRule("/legacy-dir");
    assert.ok(nested);
    assert.equal(nested.logicalPath, "/legacy-dir");

    await ctx.conn.close();
  });

  it("is idempotent when run twice", async () => {
    const ctx = await openNovelMasterTestConnection();
    await seedLegacyGlobalDirRule(ctx.conn);
    await migrateWorktreeUnifiedRoot(ctx.conn);
    await migrateWorktreeUnifiedRoot(ctx.conn);

    const wt = createWorktreeService(ctx.conn, { kind: "global" });
    assert.equal((await wt.getDirRule("/"))?.logicalPath, "/");
    assert.equal((await wt.getDirRule("/legacy-dir"))?.logicalPath, "/legacy-dir");
    const rows = await ctx.conn.query<{ logical_path: string }>(
      `SELECT logical_path FROM worktree_dir_rule WHERE scope_key = 'global'`,
    );
    assert.ok(
      !rows.some((r) => r.logical_path === "/template" || r.logical_path.startsWith("/template/")),
    );

    await ctx.conn.close();
  });
});
