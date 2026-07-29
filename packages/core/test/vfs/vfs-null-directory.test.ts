/**
 * T-NULL-DIR：insertDirectory 双 NULL；读路径不解 ContentStore、不泄漏 `"null"`。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { createVfsService } from "@novel-master/core/vfs";
import { isVfsError } from "@/errors/vfs-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("directory NULL content contract", () => {
  const GLOBAL_SCOPE = "global";

  it("T-NULL-DIR: insertDirectory 后 SQL 双 NULL；读不解 blob、不泄漏伪串", async () => {
    const { conn } = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(conn);
    const dir = `/null-dir-${testIsolationSuffix()}/d`;
    await repo.insertDirectory(GLOBAL_SCOPE, dir);

    const raw = await conn.query<{
      content: string | null;
      content_hash: string | null;
      entry_kind: string;
    }>(`SELECT content, content_hash, entry_kind FROM vfs_entry WHERE scope_key = ? AND path = ?`, [
      GLOBAL_SCOPE, dir,
    ]);
    assert.equal(raw.length, 1);
    assert.equal(raw[0]!.entry_kind, "directory");
    assert.equal(raw[0]!.content, null);
    assert.equal(raw[0]!.content_hash, null);
    // 提醒：JS 的 String(null)==="null"，所以 repo 绝不能对 SQL NULL 做 String(...)
    assert.equal(String(raw[0]!.content), "null");

    const entry = await repo.findByPath(GLOBAL_SCOPE, dir);
    assert.ok(entry);
    assert.equal(entry.entryKind, "directory");
    assert.equal(entry.content, "");
    assert.notEqual(entry.content, "null");

    const vfs = createVfsService(conn);
    await assert.rejects(
      () => vfs.read(GLOBAL_SCOPE, dir),
      (e: unknown) => {
        assert.ok(isVfsError(e, "IS_DIRECTORY"));
        return true;
      },
    );
  });

  it("T-NULL-DIR 负向：repo 源码禁止 String(row.content) / String(null) 伪串路径", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const entrySrc = readFileSync(
      path.resolve(
        here,
        "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts",
      ),
      "utf8",
    );
    const revisionSrc = readFileSync(
      path.resolve(
        here,
        "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts",
      ),
      "utf8",
    );
    assert.equal(entrySrc.includes("String(row.content)"), false);
    assert.equal(revisionSrc.includes("String(row.content)"), false);
    assert.equal(entrySrc.includes("String(null)"), false);
  });
});
