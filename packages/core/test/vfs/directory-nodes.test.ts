import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVfsService,
  createWorktreeService,
  isVfsError,
} from "@novel-master/core";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function isolatedRoot(): string {
  return `/template/${testIsolationSuffix()}`;
}

async function prepareRoot(
  vfs: ReturnType<typeof createVfsService>,
): Promise<string> {
  const root = isolatedRoot();
  await vfs.mkdir(root);
  return root;
}

describe("VFS directory nodes", () => {
  it("mkdir creates empty directory visible in list", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(drafts);
    const listed = await vfs.list(root);
    assert.deepEqual(listed, [{ path: drafts, kind: "directory" }]);
    assert.deepEqual(await vfs.list(drafts), []);
    const paths = await vfs.glob("**/.keep", { cwd: root });
    assert.equal(paths.length, 0);
  });

  it("delete empty directory and reject non-empty without recursive", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(drafts);
    await vfs.delete(drafts);
    assert.deepEqual(await vfs.list(root), []);

    await vfs.mkdir(drafts);
    await vfs.write(`${drafts}/a.md`, "x", { versionCheck: false });
    await assert.rejects(
      () => vfs.delete(drafts),
      (e: unknown) => {
        assert.ok(isVfsError(e, "DIRECTORY_NOT_EMPTY"));
        return true;
      },
    );
    await vfs.delete(drafts, { recursive: true });
    assert.deepEqual(await vfs.list(root), []);
  });

  it("read/write/replace fail on directory paths", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.mkdir(drafts);
    for (const fn of [
      () => vfs.read(drafts),
      () => vfs.write(drafts, "x", { versionCheck: false }),
      () => vfs.replace(drafts, "a", "b"),
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
    await vfs.write(`${drafts}/a.md`, "hi", { versionCheck: false });
    const listed = await vfs.list(root);
    assert.ok(listed.some((e) => e.path === drafts && e.kind === "directory"));
  });

  it("update write does not recreate deleted parent directory rows", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = await prepareRoot(vfs);
    const drafts = `${root}/drafts`;
    await vfs.write(`${drafts}/a.md`, "hi", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE path = ? AND entry_kind = 'directory'`,
      [drafts],
    );
    await vfs.write(`${drafts}/a.md`, "updated", { versionCheck: false });
    const listed = await vfs.list(root);
    assert.ok(!listed.some((e) => e.path === drafts && e.kind === "directory"));
    assert.equal((await vfs.read(`${drafts}/a.md`)).content, "updated");
  });

  it("mkdir fails when parent path is a file row", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const parentFile = `${await prepareRoot(vfs)}/parent-file`;
    await vfs.write(parentFile, "content", { versionCheck: false });
    await assert.rejects(
      () => vfs.mkdir(`${parentFile}/child`),
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
      () => vfs.mkdir(nested),
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
    await vfs.mkdir(dir);
    await vfs.write(`${dir}/.keep`, "placeholder", { versionCheck: false });
    const hits = await vfs.grep("placeholder", { cwd: root });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, `${dir}/.keep`);
    const paths = await vfs.glob("**/*", { cwd: root });
    assert.ok(!paths.includes(dir));
    assert.ok(paths.includes(`${dir}/.keep`));
  });

  it("worktree buildListRows shows explicit empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = await prepareRoot(vfs);
    await vfs.mkdir(`${root}/empty`);
    const wt = createWorktreeService(conn, { kind: "global" });
    const rows = await wt.buildListRows();
    const logicalEmpty = root.replace(/^\/template/, "") + "/empty";
    assert.ok(
      rows.some((r) => r.kind === "dir" && r.path === logicalEmpty),
    );
  });
});
