import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { findMissingRevisionPointers } from "../../src/domain/message-checkpoint/logic/detect-missing-revisions.js";
import { restorePathToRevision } from "../../src/domain/message-checkpoint/logic/restore-path.js";
import type { VfsContentStore } from "../../src/domain/vfs/content-store/vfs-content-store.port.js";
import {
  scopeKey,
  toPhysicalPath,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { revisionPairKey } from "../../src/domain/vfs/logic/revision-pair-key.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsEntryRepository } from "../../src/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "../../src/domain/vfs/repositories/vfs-revision.port.js";
import type { VfsRestorePort } from "../../src/domain/vfs/ports/vfs-restore.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 若被调用则测试失败，用于断言未触发正文解压。 */
function createNoGetContentStore(): VfsContentStore {
  return {
    put: async (plain: string) => `hash-${plain.length}`,
    get: async () => {
      throw new Error("exists 检测不应解压正文");
    },
    gc: async () => 0,
    collectAllReferencedHashes: async () => new Set(),
    ensureBlob: async () => undefined,
    size: async () => 0,
  };
}

describe("rollback version short-circuit", () => {
  it("existsByEntryAndVersion：有行即 true，且不解压 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/blob-only.md");
    const revisions = new SqliteVfsRevisionRepository(
      ctx.conn,
      createNoGetContentStore(),
    );

    // need to get entryId first; append now requires entryId
    const { SqliteVfsEntryRepository } = await import(
      "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js"
    );
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    await entries.insert(scopeKey(scope), "/blob-only.md", "seed");
    const entry = await entries.findByPath(scopeKey(scope), "/blob-only.md");
    assert.ok(entry != null);

    await revisions.append({
      entryId: entry.entryId,
      version: 3,
      content: null,
      contentHash: "deadbeef",
      status: "active",
      mtimeMs: Date.now(),
    });

    assert.equal(await revisions.existsByEntryAndVersion(entry.entryId, 3), true);
    assert.equal(await revisions.existsByEntryAndVersion(entry.entryId, 2), false);
  });

  it("findMissingRevisionPointers：用批量 findMetasByEntryVersions 而非 findByEntryAndVersion", async () => {
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    let findCalls = 0;
    let batchCalls = 0;
    const entryId = 1;
    const revisionRepo: VfsRevisionRepository = {
      findByEntryAndVersion: async () => {
        findCalls++;
        return null;
      },
      existsByEntryAndVersion: async () => {
        throw new Error("不应逐条 exists");
      },
      findMetaByEntryAndVersion: async () => null,
      findMetasByEntryVersions: async (pairs) => {
        batchCalls++;
        return new Map([
          [
            revisionPairKey(entryId, pairs[0]!.version),
            { status: "active", contentHash: null },
          ],
        ]);
      },
      findMaxVersionForEntry: async () => null,
      append: async () => undefined,
      listKeysUnderScope: async () => [],
      deleteExceptReachable: async () => 0,
      adjustRefCount: async () => undefined,
      batchAdjustRefCount: async () => undefined,
      repairRefCountFloor: async () => false,
      deleteUnreferencedUnderScope: async () => 0,
    };
    const entryRepo: VfsEntryRepository = {
      findByPath: async () => ({ entryId, path: "/a.md", version: 1, content: "", mtimeMs: 0, scopeKey: "session:p1:s1" }),
      findContentHash: async () => null,
      findContentHashesByPaths: async () => new Map(),
      list: async () => [],
      insert: async () => ({ version: 1 }),
      insertWithContentHash: async () => ({ version: 1 }),
      insertAtVersion: async () => ({ version: 1 }),
      insertDirectory: async () => undefined,
      update: async () => ({ version: 1 }),
      updateWithContentHash: async () => ({ version: 1 }),
      setHeadContentHash: async () => undefined,
      delete: async () => undefined,
      listAllPaths: async () => [],
      listDirectoryPathsUnderPrefix: async () => [],
      listEntriesUnderPrefix: async () => [],
      listFileMetaUnderPrefix: async () => [],
      listFileHeadsUnderPrefix: async () => [],
      scanContents: async () => [],
      renamePathInScope: async () => undefined,
      renamePrefixInScope: async () => undefined,
    };

    const missing = await findMissingRevisionPointers(
      revisionRepo,
      entryRepo,
      scope,
      new Map([["/a.md", 1]]),
      ["/a.md"],
    );

    assert.deepEqual(missing, []);
    assert.equal(batchCalls, 1);
    assert.equal(findCalls, 0);
  });

  it("restorePathToRevision：head version 相等时跳过 find 与 write", async () => {
    let findCalls = 0;
    let writeCalls = 0;
    const entryId = 1;
    const revisionRepo: VfsRevisionRepository = {
      findByEntryAndVersion: async () => {
        findCalls++;
        return {
          entryId,
          version: 2,
          content: "should-not-read",
          status: "active",
          mtimeMs: 0,
        };
      },
      existsByEntryAndVersion: async () => true,
      findMetaByEntryAndVersion: async () => {
        findCalls++;
        return { status: "active", contentHash: "x" };
      },
      findMetasByEntryVersions: async () => new Map(),
      findMaxVersionForEntry: async () => 2,
      append: async () => undefined,
      listKeysUnderScope: async () => [],
      deleteExceptReachable: async () => 0,
      adjustRefCount: async () => undefined,
      batchAdjustRefCount: async () => undefined,
      repairRefCountFloor: async () => false,
      deleteUnreferencedUnderScope: async () => 0,
    };
    const vfs: VfsRestorePort = {
      write: async () => {
        writeCalls++;
      },
      delete: async () => undefined,
      mkdir: async () => undefined,
      resetHeadToVersion: async () => undefined,
    };
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    const liveHeadByPath = new Map([["/same.md", 2]]);
    const entryRepo: VfsEntryRepository = {
      findByPath: async () => ({ entryId, path: "/x", version: 2, content: "", mtimeMs: 0, scopeKey: "session:p1:s1" }),
      findContentHash: async () => null,
      findContentHashesByPaths: async () => new Map(),
      list: async () => [],
      insert: async () => ({ version: 1 }),
      insertWithContentHash: async () => ({ version: 1 }),
      insertAtVersion: async () => ({ version: 1 }),
      insertDirectory: async () => undefined,
      update: async () => ({ version: 1 }),
      updateWithContentHash: async () => ({ version: 1 }),
      setHeadContentHash: async () => undefined,
      delete: async () => undefined,
      listAllPaths: async () => [],
      listDirectoryPathsUnderPrefix: async () => [],
      listEntriesUnderPrefix: async () => [],
      listFileMetaUnderPrefix: async () => [],
      listFileHeadsUnderPrefix: async () => [],
      scanContents: async () => [],
      renamePathInScope: async () => undefined,
      renamePrefixInScope: async () => undefined,
    };

    const outcome = await restorePathToRevision(
      vfs,
      revisionRepo,
      scope,
      "/same.md",
      2,
      liveHeadByPath,
      entryRepo,
    );

    assert.equal(outcome, "skipped_same_version");
    assert.equal(findCalls, 0);
    assert.equal(writeCalls, 0);
  });

  it("restorePathToRevision：version 不等但 content_hash 相同则跳过解压与 write", async () => {
    let findFullCalls = 0;
    let findMetaCalls = 0;
    let writeCalls = 0;
    const entryId = 1;
    const revisionRepo: VfsRevisionRepository = {
      findByEntryAndVersion: async () => {
        findFullCalls++;
        return {
          entryId,
          version: 1,
          content: "should-not-read",
          status: "active",
          mtimeMs: 0,
        };
      },
      existsByEntryAndVersion: async () => true,
      findMetaByEntryAndVersion: async () => {
        findMetaCalls++;
        return { status: "active", contentHash: "same-hash" };
      },
      findMetasByEntryVersions: async () => new Map(),
      findMaxVersionForEntry: async () => 3,
      append: async () => undefined,
      listKeysUnderScope: async () => [],
      deleteExceptReachable: async () => 0,
      adjustRefCount: async () => undefined,
      batchAdjustRefCount: async () => undefined,
      repairRefCountFloor: async () => false,
      deleteUnreferencedUnderScope: async () => 0,
    };
    const entryRepo = {
      findContentHash: async () => "same-hash",
      findContentHashesByPaths: async () => new Map(),
      findByPath: async () => ({ entryId }),
    } as unknown as VfsEntryRepository;
    const vfs: VfsRestorePort = {
      write: async () => {
        writeCalls++;
      },
      delete: async () => undefined,
      mkdir: async () => undefined,
      resetHeadToVersion: async () => undefined,
    };
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    // live head 高于锚点（T-RB1），但正文 hash 已与目标 revision 一致
    const liveHeadByPath = new Map([["/hash-same.md", 3]]);

    const outcome = await restorePathToRevision(
      vfs,
      revisionRepo,
      scope,
      "/hash-same.md",
      1,
      liveHeadByPath,
      entryRepo,
    );

    assert.equal(outcome, "skipped_same_content_hash");
    assert.equal(findMetaCalls, 1);
    assert.equal(findFullCalls, 0);
    assert.equal(writeCalls, 0);
  });

  it("restorePathToRevision：head version 不等且正文不同时仍执行 restore", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const { SqliteVfsEntryRepository } = await import(
      "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js"
    );
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    await svfs.write("/delta.md", "anchor", { versionCheck: false });
    const anchorVersion = (await svfs.read("/delta.md")).version;
    await svfs.write("/delta.md", "tail", { versionCheck: false });
    const liveHeadByPath = new Map([
      ["/delta.md", (await svfs.read("/delta.md")).version],
    ]);

    const outcome = await restorePathToRevision(
      svfs,
      revisions,
      scope,
      "/delta.md",
      anchorVersion,
      liveHeadByPath,
      entries,
    );

    assert.equal(outcome, "restored");
    assert.equal((await svfs.read("/delta.md")).content, "anchor");
  });

  it("RB-SC1：head 与 checkpoint 同 version 时回滚截断消息且正文不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/stable.md", "keep-me", { versionCheck: false });
    const headVersion = (await svfs.read("/stable.md")).version;
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("u1"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a1" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("u2"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a2" }],
    });

    assert.equal((await svfs.read("/stable.md")).version, headVersion);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/stable.md")).content, "keep-me");
    assert.equal((await svfs.read("/stable.md")).version, headVersion);
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });
});
