import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorktreeService } from "@novel-master/core";
import { cleanupBrokenWorktreeLogicalPathsOnce } from "../../src/bootstrap/worktree/cleanup-worktree-unified-root-once.js";
import { migrateWorktreeUnifiedRoot } from "../../src/bootstrap/worktree/migrate-worktree-unified-root.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

type ExecConn = {
  execute: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<T[]>;
};

async function seedLegacyGlobalDirRule(conn: ExecConn): Promise<void> {
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

async function seedLegacyGlobalFileRule(conn: ExecConn): Promise<void> {
  await conn.execute(
    `INSERT INTO worktree_file_rule (scope_key, logical_path, inclusion_mode)
     VALUES ('global', '/template/legacy.md', 'hide')`,
  );
}

async function seedLegacyProjectRules(
  conn: ExecConn,
  projectId: string,
): Promise<void> {
  const scopeKey = `project:${projectId}`;
  await conn.execute(
    `INSERT INTO worktree_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES (
       '${scopeKey}', '/template', 1, 'name', 'asc', 0, 0, 'hidden'
     )`,
  );
  await conn.execute(
    `INSERT INTO worktree_dir_rule (
       scope_key, logical_path, rule_enabled, sort_field, sort_order,
       head_count, tail_count, fill_policy
     ) VALUES (
       '${scopeKey}', '/template/nested', 1, 'name', 'asc', 0, 0, 'hidden'
     )`,
  );
  await conn.execute(
    `INSERT INTO worktree_file_rule (scope_key, logical_path, inclusion_mode)
     VALUES ('${scopeKey}', '/template/file.md', 'show')`,
  );
}

function assertNoLegacyTemplatePaths(
  rows: readonly { logical_path: string }[],
): void {
  assert.ok(
    !rows.some(
      (r) =>
        r.logical_path === "/template" ||
        r.logical_path.startsWith("/template/"),
    ),
  );
}

describe("migrateWorktreeUnifiedRoot", () => {
  it("T9: rewrites legacy global worktree_dir_rule to unified root", async () => {
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

  it("T9: rewrites legacy global worktree_file_rule", async () => {
    const ctx = await openNovelMasterTestConnection();
    await seedLegacyGlobalFileRule(ctx.conn);
    await migrateWorktreeUnifiedRoot(ctx.conn);

    const rows = await ctx.conn.query<{ logical_path: string; inclusion_mode: string }>(
      `SELECT logical_path, inclusion_mode FROM worktree_file_rule WHERE scope_key = 'global'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.logical_path, "/legacy.md");
    assert.equal(rows[0]!.inclusion_mode, "hide");

    await ctx.conn.close();
  });

  it("T9: rewrites legacy project scope dir and file rules", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P-migrate");
    await seedLegacyProjectRules(ctx.conn, project.id);
    await migrateWorktreeUnifiedRoot(ctx.conn);

    const wt = createWorktreeService(ctx.conn, {
      kind: "project",
      projectId: project.id,
    });
    const root = await wt.getDirRule("/");
    assert.ok(root);
    assert.equal(root.logicalPath, "/");

    const nested = await wt.getDirRule("/nested");
    assert.ok(nested);

    const fileRows = await ctx.conn.query<{
      logical_path: string;
      inclusion_mode: string;
    }>(
      `SELECT logical_path, inclusion_mode FROM worktree_file_rule WHERE scope_key = 'project:${project.id}'`,
    );
    assert.equal(fileRows.length, 1);
    assert.equal(fileRows[0]!.logical_path, "/file.md");
    assert.equal(fileRows[0]!.inclusion_mode, "show");

    await ctx.conn.close();
  });

  it("one-time cleanup deletes corrupted e/ paths (no repair)", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.conn.execute(
      `INSERT INTO worktree_file_rule (scope_key, logical_path, inclusion_mode)
       VALUES ('global', 'e/xxx.md', 'auto')`,
    );
    await cleanupBrokenWorktreeLogicalPathsOnce(ctx.conn);

    const rows = await ctx.conn.query<{ logical_path: string }>(
      `SELECT logical_path FROM worktree_file_rule WHERE scope_key = 'global'`,
    );
    assert.equal(rows.length, 0);

    const wt = createWorktreeService(ctx.conn, { kind: "global" });
    await wt.buildListRows();

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
    assertNoLegacyTemplatePaths(rows);

    await ctx.conn.close();
  });
});
