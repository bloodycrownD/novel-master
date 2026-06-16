import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  scopePhysicalPrefix,
  toPhysicalPath,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { revisionReachableKey } from "../../src/domain/message-checkpoint/logic/revision-gc.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("revision GC", () => {
  it("R8: rollback deletes tail-only revisions while keeping anchor references", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "a" }],
    });
    await svfs.write("/gc.md", "v1", { versionCheck: false });
    const v1 = (await svfs.read("/gc.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });
    await svfs.write("/gc.md", "v2", { versionCheck: false });
    const v2 = (await svfs.read("/gc.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/gc.md");
    const prefix = scopePhysicalPrefix(scope);

    const before = await revisions.listKeysUnderPrefix(prefix);
    assert.ok(before.some((r) => r.path === physical && r.version === v1));
    assert.ok(before.some((r) => r.path === physical && r.version === v2));

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    const after = await revisions.listKeysUnderPrefix(prefix);
    assert.ok(after.some((r) => r.path === physical && r.version === v1));
    assert.equal(
      after.some((r) => r.path === physical && r.version === v2),
      false,
    );

    const head = (await svfs.read("/gc.md")).version;
    assert.notEqual(head, v2);
    assert.equal(revisionReachableKey(physical, v1).includes(physical), true);
  });

  it("sweep drops intermediate revisions not referenced by checkpoint or live head", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/trim.md", "one", { versionCheck: false });
    const v1 = (await svfs.read("/trim.md")).version;
    await svfs.write("/trim.md", "two", { versionCheck: false });
    const v2 = (await svfs.read("/trim.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/trim.md");
    const prefix = scopePhysicalPrefix(scope);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant.id,
    );

    const keys = await revisions.listKeysUnderPrefix(prefix);
    const versions = keys
      .filter((k) => k.path === physical)
      .map((k) => k.version);
    assert.ok(versions.includes(v2));
    assert.equal(versions.includes(v1), false);
  });
});
