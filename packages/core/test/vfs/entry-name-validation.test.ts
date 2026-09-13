/**
 * VFS 条目名校验的 service 层接入测试：
 * - 创建（write 创建分支 / mkdir）与重命名（renamePath / renamePrefix）拒绝非法名，
 *   错误 code 为 INVALID_NAME 且 message 为中文 reason；
 * - 「只拦创建/重命名」：手插的存量脏名条目（模拟 zip 导入历史）内容更新不受影响；
 * - 中文名等核心场景照常放行。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVfsService,
  isVfsError,
} from "@novel-master/core/vfs";
import { VfsError } from "../../src/errors/vfs-errors.js";
import { formatVfsErrorForUser } from "../../src/domain/vfs/logic/format-vfs-error-for-user.js";
import { insertFileSeedingRevision } from "../../src/domain/vfs/logic/seed-live-head-revisions.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("VFS entry name validation (service)", () => {
  // createVfsService = RevisionAware 包装 Default，两层校验（write 走
  // writeWithRevision；mkdir 委托 inner；rename* 只在 RevisionAware 实现）
  const SCOPE = "global";
  const SUFFIX = testIsolationSuffix();

  function scoped(name: string): string {
    return `/${SUFFIX}${name}`;
  }

  it("write 创建带换行的文件名被拒（INVALID_NAME）", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    await assert.rejects(
      () => vfs.write(SCOPE, scoped("/坏\n名.txt"), "x"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "INVALID_NAME"));
        assert.equal((e as { message: string }).message, "文件名不能包含换行或控制字符");
        return true;
      },
    );
  });

  it("write 创建带制表符/首尾空格的文件名被拒", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    await assert.rejects(
      () => vfs.write(SCOPE, scoped("/带\t制表.txt"), "x"),
      (e: unknown) => isVfsError(e, "INVALID_NAME"),
    );
    await assert.rejects(
      () => vfs.write(SCOPE, scoped("/ 首空格.txt"), "x"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "INVALID_NAME"));
        assert.equal(
          (e as { message: string }).message,
          "文件名不能以空格开头或结尾",
        );
        return true;
      },
    );
  });

  it("mkdir 带控制字符的目录名被拒", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    await assert.rejects(
      () => vfs.mkdir(SCOPE, scoped("/目录\u0007")),
      (e: unknown) => isVfsError(e, "INVALID_NAME"),
    );
  });

  it("renamePath 目标名带换行被拒", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const from = scoped("/可改名.txt");
    await vfs.write(SCOPE, from, "x");
    await assert.rejects(
      () => vfs.renamePath(SCOPE, from, scoped("/新\n名.txt")),
      (e: unknown) => isVfsError(e, "INVALID_NAME"),
    );
  });

  it("renamePrefix 目录新名纯空白被拒", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const dir = scoped("/dir");
    await vfs.mkdir(SCOPE, dir);
    await vfs.write(SCOPE, `${dir}/a.txt`, "x");
    await assert.rejects(
      () => vfs.renamePrefix(SCOPE, dir, scoped("/　")),
      (e: unknown) => isVfsError(e, "INVALID_NAME"),
    );
  });

  it("存量脏名条目（模拟 zip 导入历史）内容更新不受校验影响", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const legacyPath = scoped("/历史\n导入名.txt");
    // zip 导入同款落库路径（repo 直写，不经 service 校验）
    await insertFileSeedingRevision(
      new SqliteVfsEntryRepository(ctx.conn),
      new SqliteVfsRevisionRepository(ctx.conn),
      SCOPE,
      legacyPath,
      "初始内容",
    );
    // 内容更新（非创建）不重新审判存量名字
    const updated = await vfs.write(SCOPE, legacyPath, "new content");
    assert.ok(updated.version >= 2);
    assert.equal((await vfs.read(SCOPE, legacyPath)).content, "new content");
  });

  it("中文名/中间空格/括号等核心场景照常创建与重命名", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    const zh = scoped("/第 2 章【修订】.txt");
    await vfs.write(SCOPE, zh, "内容");
    assert.equal((await vfs.read(SCOPE, zh)).content, "内容");

    const renamed = scoped("/第 3 章【终稿】.txt");
    await vfs.renamePath(SCOPE, zh, renamed);
    assert.equal((await vfs.read(SCOPE, renamed)).content, "内容");

    const dir = scoped("/中文目录");
    await vfs.mkdir(SCOPE, dir);
    const entries = await vfs.list(SCOPE, scoped("/"));
    assert.ok(entries.some((e) => e.path === dir));
  });

  it("formatVfsErrorForUser 对 INVALID_NAME 直接透出中文 reason", () => {
    const message = formatVfsErrorForUser(
      new VfsError("INVALID_NAME", "文件名不能包含换行或控制字符", {
        path: "坏\n名",
      }),
    );
    assert.equal(message, "文件名不能包含换行或控制字符");
  });
});
