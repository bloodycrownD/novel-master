import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("worktree list order", () => {
  it("emits child directories before sibling files at each level", async () => {
    const ctx = getNovelMasterTestContext();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/parent/a.md", "A");
    await gvfs.write("/parent/sub/b.md", "B");

    const wt = createWorkplaceService(ctx.conn, { kind: "global" });
    await wt.setFileRule({
      logicalPath: "/parent/a.md",
      inclusionMode: "show",
    });
    await wt.setFileRule({
      logicalPath: "/parent/sub/b.md",
      inclusionMode: "show",
    });
    const rows = await wt.buildListRows();

    const parentDir = "/parent";
    const subDir = "/parent/sub";
    const aFile = "/parent/a.md";

    const parentIdx = rows.findIndex((r) => r.path === parentDir);
    const subIdx = rows.findIndex((r) => r.path === subDir);
    const aIdx = rows.findIndex((r) => r.path === aFile);

    assert.ok(parentIdx >= 0, "parent dir row");
    assert.ok(subIdx >= 0, "sub dir row");
    assert.ok(aIdx >= 0, "a.md file row");
    assert.ok(subIdx > parentIdx, "sub dir after parent dir");
    assert.ok(aIdx > parentIdx, "a.md after parent dir");
    assert.ok(subIdx < aIdx, "sub dir before sibling a.md");

    const display = await wt.renderDisplay();
    const subPos = display.indexOf('path="/parent/sub/b.md"');
    const aPos = display.indexOf('path="/parent/a.md"');
    assert.ok(subPos >= 0, "sub file in display");
    assert.ok(aPos >= 0, "a.md in display");
    assert.ok(subPos < aPos, "display DFS: sub tree before sibling file");
  });
});
