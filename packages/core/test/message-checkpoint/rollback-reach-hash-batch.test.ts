import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMissingRevisionPointers } from "../../src/domain/message-checkpoint/logic/detect-missing-revisions.js";
import {
  restorePathToRevision,
  type RestorePathPrefetch,
} from "../../src/domain/message-checkpoint/logic/restore-path.js";
import { revisionPairKey } from "../../src/domain/vfs/logic/revision-pair-key.js";
import {
  scopeKey,
  toPhysicalPath,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
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

describe("rollback reach hash batch", () => {
  it("listDistinctCheckpointPointersForSession：同 path+version 跨 checkpoint 只计一次", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const repo = new SqliteMessageCheckpointRepository(ctx.conn);

    await svfs.write("/dup.md", "v1", { versionCheck: false });
    const version = (await svfs.read("/dup.md")).version;

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a1" }],
    });
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a2" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    const all = await repo.listFilePointersForSession(session.id);
    const distinct = await repo.listDistinctCheckpointPointersForSession(
      session.id,
    );

    assert.equal(all.length, 2);
    assert.equal(distinct.length, 1);
    // distinct 按 entryId 去重，不再返回 logicalPath
    assert.equal(distinct[0]!.revisionVersion, version);
    assert.ok(typeof distinct[0]!.entryId === "number");
  });

  it("findMissingRevisionPointers：批量 findMetasByEntryVersions，零逐条 exists", async () => {
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    let findCalls = 0;
    let batchCalls = 0;
    const revisionRepo: VfsRevisionRepository = {
      findByEntryAndVersion: async () => {
        findCalls++;
        return null;
      },
      existsByEntryAndVersion: async () => {
        throw new Error("不应逐条 exists");
      },
      findMetaByEntryAndVersion: async () => {
        throw new Error("不应逐条 findMeta");
      },
      findMetasByEntryVersions: async (pairs) => {
        batchCalls++;
        const map = new Map<string, { status: "active"; contentHash: string | null }>();
        for (const pair of pairs) {
          map.set(revisionPairKey(pair.entryId, pair.version), {
            status: "active",
            contentHash: null,
          });
        }
        return map;
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
      findByPath: async () => ({ entryId: 1, path: "/a.md", version: 1, content: "", mtimeMs: 0, scopeKey: "session:p1:s1" }),
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
      new Map([
        ["/a.md", 1],
        ["/b.md", 2],
      ]),
      ["/a.md", "/b.md"],
    );

    assert.deepEqual(missing, []);
    assert.equal(batchCalls, 1);
    assert.equal(findCalls, 0);
  });

  it("restorePathToRevision：prefetch 命中时零逐条 findMeta / findContentHash", async () => {
    let findMetaCalls = 0;
    let findFullCalls = 0;
    let findHashCalls = 0;
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    const sk = scopeKey(scope);
    const entryId = 1;
    const revisionRepo: VfsRevisionRepository = {
      findByEntryAndVersion: async () => {
        findFullCalls++;
        return null;
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
      findContentHash: async () => {
        findHashCalls++;
        return "same-hash";
      },
      findContentHashesByPaths: async () => new Map(),
      findByPath: async () => ({ entryId }),
    } as unknown as VfsEntryRepository;
    const vfs: VfsRestorePort = {
      write: async () => undefined,
      delete: async () => undefined,
      mkdir: async () => undefined,
    };
    const prefetch: RestorePathPrefetch = {
      entryIdByPath: new Map([["/hash-same.md", entryId]]),
      revisionMetaByKey: new Map([
        [revisionPairKey(entryId, 1), { status: "active", contentHash: "same-hash" }],
      ]),
      liveHashByPath: new Map([["/hash-same.md", "same-hash"]]),
    };

    const outcome = await restorePathToRevision(
      vfs,
      revisionRepo,
      scope,
      "/hash-same.md",
      1,
      new Map([["/hash-same.md", 3]]),
      entryRepo,
      prefetch,
    );

    assert.equal(outcome, "skipped_same_content_hash");
    assert.equal(findMetaCalls, 0);
    assert.equal(findHashCalls, 0);
    assert.equal(findFullCalls, 0);
  });

  it("deleteExceptReachable：批量删除不可达 revision 行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);

    await svfs.write("/batch-del.md", "keep", { versionCheck: false });
    await svfs.write("/batch-del.md", "drop-me", { versionCheck: false });
    await svfs.write("/batch-del.md", "live", { versionCheck: false });

    const entry = await entries.findByPath(sk, "/batch-del.md");
    assert.ok(entry != null);
    const liveVersion = (await svfs.read("/batch-del.md")).version;
    const reachable = new Set([revisionPairKey(entry.entryId, liveVersion)]);

    const deleted = await revisions.deleteExceptReachable(sk, "/", reachable);
    const keys = await revisions.listKeysUnderScope(sk, "/");
    const versions = keys
      .filter((key) => key.entryId === entry.entryId)
      .map((key) => key.version);

    assert.equal(deleted, 2);
    assert.deepEqual(versions, [liveVersion]);
    assert.equal((await svfs.read("/batch-del.md")).content, "live");
  });
});
