import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  scopePhysicalPrefix,
  toPhysicalPath,
} from "../../src/domain/vfs/logic/vfs-path-mapper.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("MessageService.delete checkpoint GC", () => {
  it("removes message checkpoint and GCs tail-only revisions", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
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
    const physical = toPhysicalPath(scope, "/gc-delete.md");
    const prefix = scopePhysicalPrefix(scope);

    await ctx.messages.delete(assistant.id);

    assert.equal((await svfs.read("/gc-delete.md")).content, "v2");
    assert.equal(await checkpoints.hasCheckpoint(session.id, assistant.id), false);
    const keys = await revisions.listKeysUnderPrefix(prefix);
    assert.ok(keys.some((k) => k.path === physical && k.version === v2));
    assert.equal(
      keys.some((k) => k.path === physical && k.version === v1),
      false,
    );

    await ctx.conn.close();
  });
});
