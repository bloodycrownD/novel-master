import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVfsService, isVfsError } from "@novel-master/core/vfs";

import { createWorkplaceService } from "@novel-master/core/workplace";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const GLOBAL_SCOPE = "global";

function isolatedRoot(): string {
  return `/${testIsolationSuffix()}`;
}

async function prepareRoot(
  vfs: ReturnType<typeof createVfsService>,
): Promise<string> {
  const root = isolatedRoot();
  await vfs.mkdir(GLOBAL_SCOPE, root);
  return root;
}

describe("VFS directory nodes", () => {
  it("mkdir creates empty directory visible in list", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(GLOBAL_SCOPE, drafts);
    const listed = await vfs.list(GLOBAL_SCOPE, root);
    assert.deepEqual(listed, [
      { path: drafts, kind: "directory", version: 1 },
    ]);
    assert.deepEqual(await vfs.list(GLOBAL_SCOPE, drafts), []);
    const paths = await vfs.glob(GLOBAL_SCOPE, "**/.keep", { cwd: root });
    assert.equal(paths.length, 0);
  });

  it("delete empty directory and reject non-empty without recursive", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(GLOBAL_SCOPE, drafts);
    await vfs.delete(GLOBAL_SCOPE, drafts);
    assert.deepEqual(await vfs.list(GLOBAL_SCOPE, root), []);

    await vfs.mkdir(GLOBAL_SCOPE, drafts);
    await vfs.write(GLOBAL_SCOPE, `${drafts}/a.md`, "x", { versionCheck: false });
    await assert.rejects(
      () => vfs.delete(GLOBAL_SCOPE, drafts),
      (e: unknown) => {
        assert.ok(isVfsError(e, "DIRECTORY_NOT_EMPTY"));
        return true;
      },
    );
    await vfs.delete(GLOBAL_SCOPE, drafts, { recursive: true });
    assert.deepEqual(await vfs.list(GLOBAL_SCOPE, root), []);
  });

  it("read/write/replace fail on directory paths", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(GLOBAL_SCOPE, drafts);
    for (const fn of [
      () => vfs.read(GLOBAL_SCOPE, drafts),
      () => vfs.write(GLOBAL_SCOPE, drafts, "x", { versionCheck: false }),
      () => vfs.replace(GLOBAL_SCOPE, drafts, "a", "b"),
    ]) {
      await assert.rejects(fn, (e: unknown) => {
        assert.ok(isVfsError(e, "IS_DIRECTORY"));
        return true;
      });
    }
  });

  it("write ensures parent directory chain", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.write(GLOBAL_SCOPE, `${drafts}/a.md`, "hi", { versionCheck: false });
    const listed = await vfs.list(GLOBAL_SCOPE, root);
    assert.ok(listed.some((e) => e.path === drafts && e.kind === "directory"));
  });

  it("update write does not recreate deleted parent directory rows", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.write(GLOBAL_SCOPE, `${drafts}/a.md`, "hi", { versionCheck: false });
    // 更新 write 后查 entry 用 scope_key + 逻辑路径
    const dirPath = drafts;
    await conn.execute(
      `DELETE FROM vfs_entry WHERE scope_key = ? AND path = ? AND entry_kind = 'directory'`,
      [GLOBAL_SCOPE, dirPath],
    );
    await vfs.write(GLOBAL_SCOPE, `${drafts}/a.md`, "updated", { versionCheck: false });
    const listed = await vfs.list(GLOBAL_SCOPE, root);
    assert.ok(!listed.some((e) => e.path === drafts && e.kind === "directory"));
    assert.equal((await vfs.read(GLOBAL_SCOPE, `${drafts}/a.md`)).content, "updated");
  });

  it("recursive delete succeeds for virtual directory without directory row", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = await prepareRoot(vfs);
    const dir = `${root}/55`;
    await vfs.write(GLOBAL_SCOPE, `${dir}/诗歌.txt`, "poem", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE scope_key = ? AND path = ? AND entry_kind = 'directory'`,
      [GLOBAL_SCOPE, dir],
    );

    await vfs.delete(GLOBAL_SCOPE, dir, { recursive: true });

    await assert.rejects(
      () => vfs.read(GLOBAL_SCOPE, `${dir}/诗歌.txt`),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("recursive delete succeeds for worktree-only empty virtual directory", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const dir = `${root}/empty-virtual`;
    await assert.doesNotReject(() => vfs.delete(GLOBAL_SCOPE, dir, { recursive: true }));
  });

  it("mkdir fails when parent path is a file row", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const parentFile = `${await prepareRoot(vfs)}/parent-file`;
    await vfs.write(GLOBAL_SCOPE, parentFile, "content", { versionCheck: false });
    await assert.rejects(
      () => vfs.mkdir(GLOBAL_SCOPE, `${parentFile}/child`),
      (e: unknown) => {
        assert.ok(isVfsError(e, "NOT_A_DIRECTORY"));
        return true;
      },
    );
  });

  it("mkdir requires existing parent", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const nested = `${await prepareRoot(vfs)}/nested/leaf`;
    await assert.rejects(
      () => vfs.mkdir(GLOBAL_SCOPE, nested),
      (e: unknown) => {
        assert.ok(isVfsError(e, "PARENT_NOT_FOUND"));
        return true;
      },
    );
  });

  it("grep skips directory rows; glob skips directory paths", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const dir = `${root}/dir`;
    await vfs.mkdir(GLOBAL_SCOPE, dir);
    await vfs.write(GLOBAL_SCOPE, `${dir}/.keep`, "placeholder", { versionCheck: false });
    const hits = await vfs.grep(GLOBAL_SCOPE, "placeholder", { cwd: root });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, `${dir}/.keep`);
    const paths = await vfs.glob(GLOBAL_SCOPE, "**/*", { cwd: root });
    assert.ok(!paths.includes(dir));
    assert.ok(paths.includes(`${dir}/.keep`));
  });

  it("worktree buildListRows shows explicit empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = await prepareRoot(vfs);
    await vfs.mkdir(GLOBAL_SCOPE, `${root}/empty`);
    const wt = createWorkplaceService(conn, { kind: "global" });
    const rows = await wt.buildListRows();
    const logicalEmpty = root + "/empty";
    assert.ok(
      rows.some((r) => r.kind === "dir" && r.path === logicalEmpty),
    );
  });
});
