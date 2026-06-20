/**
 * restore-mutating-path-heads 单测
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureMutatingPathHeadSnapshots,
  restoreMutatingPathHeads,
} from "../../src/domain/vfs/logic/restore-mutating-path-heads.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("restoreMutatingPathHeads", () => {
  it("present 路径写回旧 content；absent 路径 delete 新建文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/base.md", "before", { versionCheck: false });

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, [
      "/base.md",
      "/new.md",
    ]);

    await vfs.write("/base.md", "mutated", { versionCheck: false });
    await vfs.write("/new.md", "created", { versionCheck: false });

    await restoreMutatingPathHeads(vfs, snapshots, ["/base.md", "/new.md"]);

    assert.equal((await vfs.read("/base.md")).content, "before");
    await assert.rejects(() => vfs.read("/new.md"));
  });
});
