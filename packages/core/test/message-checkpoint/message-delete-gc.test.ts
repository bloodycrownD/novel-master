import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  scopeKey,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("MessageService.delete checkpoint GC", () => {
  it("removes message checkpoint and GCs tail-only revisions", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/gc-delete.md", "v1", { versionCheck: false });
    const v1 = (await svfs.read("/gc-delete.md")).version;
    await svfs.write("/gc-delete.md", "v2", { versionCheck: false });
    const v2 = (await svfs.read("/gc-delete.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);
    const entry = await entries.findByPath(sk, "/gc-delete.md");
    assert.ok(entry != null);

    await ctx.messages.delete(assistant.id);

    assert.equal((await svfs.read("/gc-delete.md")).content, "v2");
    assert.equal(await checkpoints.hasCheckpoint(session.id, assistant.id), false);
    const keys = await revisions.listKeysUnderScope(sk, "/");
    assert.ok(keys.some((k) => k.entryId === entry.entryId && k.version === v2));
    assert.equal(
      keys.some((k) => k.entryId === entry.entryId && k.version === v1),
      false,
    );
  });
});
