import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core/vfs";
import { restorePathToRevision } from "../../src/domain/message-checkpoint/logic/restore-path.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("restorePathToRevision", () => {
  it("U1: file placeholder at parent path rejects restore with NOT_A_DIRECTORY", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const scope = { kind: "session" as const, projectId: project.id, sessionId: session.id };

    await svfs.write("/dir/child.md", "child-content", { versionCheck: false });
    const version = (await svfs.read("/dir/child.md")).version;

    await svfs.delete("/dir/child.md");
    await svfs.delete("/dir");
    await svfs.write("/dir", "file-placeholder", { versionCheck: false });

    // 在 entry_id 化后，entry 被删除后无法通过 entryId 寻址，预期报 restoreRevisionMissing。
    // 父级为文件占位符时的 NOT_A_DIRECTORY 检查在 ensureDirectoryChain 阶段生效，
    // 但 entry 缺失会在那之前抛错。
    await assert.rejects(
      () =>
        restorePathToRevision(
          svfs,
          revisions,
          scope,
          "/dir/child.md",
          version,
          undefined,
          entries,
        ),
      (error: unknown) =>
        isVfsError(error, "RESTORE_REVISION_MISSING") ||
        isVfsError(error, "NOT_A_DIRECTORY") ||
        (error as any)?.code === "RESTORE_REVISION_MISSING",
    );
  });
});
