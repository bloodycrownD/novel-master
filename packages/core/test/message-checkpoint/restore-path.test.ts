import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core/vfs";
import { restorePathToRevision } from "../../src/domain/message-checkpoint/logic/restore-path.js";
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
    const scope = { kind: "session" as const, projectId: project.id, sessionId: session.id };

    await svfs.write("/dir/child.md", "child-content", { versionCheck: false });
    const version = (await svfs.read("/dir/child.md")).version;

    await svfs.delete("/dir/child.md");
    await svfs.delete("/dir");
    await svfs.write("/dir", "file-placeholder", { versionCheck: false });

    await assert.rejects(
      () =>
        restorePathToRevision(
          svfs,
          revisions,
          scope,
          "/dir/child.md",
          version,
        ),
      (error: unknown) => isVfsError(error, "NOT_A_DIRECTORY"),
    );
  });
});
