import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { findMissingRevisionPointers } from "../../src/domain/message-checkpoint/logic/detect-missing-revisions.js";
import { restorePathToRevision } from "../../src/domain/message-checkpoint/logic/restore-path.js";
import type { VfsContentStore } from "../../src/domain/vfs/content-store/vfs-content-store.port.js";
import { toPhysicalPath } from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
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
  };
}

describe("rollback version short-circuit", () => {
  it("existsByPathAndVersion：有行即 true，且不解压 blob", async () => {
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

    await revisions.append({
      path: physical,
      version: 3,
      content: null,
      contentHash: "deadbeef",
      status: "active",
      mtimeMs: Date.now(),
      storageKind: "inline",
    });

    assert.equal(await revisions.existsByPathAndVersion(physical, 3), true);
    assert.equal(await revisions.existsByPathAndVersion(physical, 2), false);
  });

  it("findMissingRevisionPointers：用 exists 而非 findByPathAndVersion", async () => {
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    let findCalls = 0;
    let existsCalls = 0;
    const revisionRepo: VfsRevisionRepository = {
      findByPathAndVersion: async () => {
        findCalls++;
        return null;
      },
      existsByPathAndVersion: async () => {
        existsCalls++;
        return true;
      },
      findMetaByPathAndVersion: async () => null,
      findMaxVersionForPath: async () => null,
      append: async () => undefined,
      listKeysUnderPrefix: async () => [],
      deleteExceptReachable: async () => 0,
    };

    const missing = await findMissingRevisionPointers(
      revisionRepo,
      scope,
      new Map([["/a.md", 1]]),
      ["/a.md"],
    );

    assert.deepEqual(missing, []);
    assert.equal(existsCalls, 1);
    assert.equal(findCalls, 0);
  });

  it("restorePathToRevision：head version 相等时跳过 find 与 write", async () => {
    let findCalls = 0;
    let writeCalls = 0;
    const revisionRepo: VfsRevisionRepository = {
      findByPathAndVersion: async () => {
        findCalls++;
        return {
          path: "/x",
          version: 2,
          content: "should-not-read",
          status: "active",
          mtimeMs: 0,
          storageKind: "inline",
        };
      },
      existsByPathAndVersion: async () => true,
      findMetaByPathAndVersion: async () => {
        findCalls++;
        return { status: "active", contentHash: "x" };
      },
      findMaxVersionForPath: async () => 2,
      append: async () => undefined,
      listKeysUnderPrefix: async () => [],
      deleteExceptReachable: async () => 0,
    };
    const vfs: VfsRestorePort = {
      write: async () => {
        writeCalls++;
      },
      delete: async () => undefined,
      mkdir: async () => undefined,
    };
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    const liveHeadByPath = new Map([["/same.md", 2]]);

    const outcome = await restorePathToRevision(
      vfs,
      revisionRepo,
      scope,
      "/same.md",
      2,
      liveHeadByPath,
    );

    assert.equal(outcome, "skipped_same_version");
    assert.equal(findCalls, 0);
    assert.equal(writeCalls, 0);
  });

  it("restorePathToRevision：version 不等但 content_hash 相同则跳过解压与 write", async () => {
    let findFullCalls = 0;
    let findMetaCalls = 0;
    let writeCalls = 0;
    const revisionRepo: VfsRevisionRepository = {
      findByPathAndVersion: async () => {
        findFullCalls++;
        return {
          path: "/x",
          version: 1,
          content: "should-not-read",
          status: "active",
          mtimeMs: 0,
          storageKind: "inline",
        };
      },
      existsByPathAndVersion: async () => true,
      findMetaByPathAndVersion: async () => {
        findMetaCalls++;
        return { status: "active", contentHash: "same-hash" };
      },
      findMaxVersionForPath: async () => 3,
      append: async () => undefined,
      listKeysUnderPrefix: async () => [],
      deleteExceptReachable: async () => 0,
    };
    const entryRepo = {
      findContentHash: async () => "same-hash",
    } as import("../../src/domain/vfs/repositories/vfs-entry.port.js").VfsEntryRepository;
    const vfs: VfsRestorePort = {
      write: async () => {
        writeCalls++;
      },
      delete: async () => undefined,
      mkdir: async () => undefined,
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
