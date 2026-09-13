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

  it("T-WE3: 智能排序下 head/tail 展示档位随新序（第四章 [4] < 第十章 [10]，与 name 序不同）", async () => {
    const ctx = getNovelMasterTestContext();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/novel/第十章.md", "TEN");
    await gvfs.write("/novel/第四章.md", "FOUR");
    await gvfs.write("/novel/第一章.md", "ONE");

    const wt = createWorkplaceService(ctx.conn, { kind: "global" });
    await wt.setDirRule({
      logicalPath: "/novel",
      ruleEnabled: true,
      sortField: "smart",
      sortOrder: "asc",
      headCount: 1,
      tailCount: 1,
      fillPolicy: "hidden",
    });
    const rows = await wt.buildListRows();
    const fileRows = rows.filter((r) => r.path.startsWith("/novel/"));
    // smart 序：第一章 [1] → 第四章 [4] → 第十章 [10]（name 拼音序会是 十/四/一）
    assert.deepEqual(
      fileRows.map((r) => r.path),
      ["/novel/第一章.md", "/novel/第四章.md", "/novel/第十章.md"],
    );
    // head=1 → 第一章 full；tail=1 → 第十章 full；中间第四章 hidden
    const stateByPath = new Map(fileRows.map((r) => [r.path, r.displayState]));
    assert.equal(stateByPath.get("/novel/第一章.md"), "full");
    assert.equal(stateByPath.get("/novel/第四章.md"), "hidden");
    assert.equal(stateByPath.get("/novel/第十章.md"), "full");
  });

  it("T-WE3b: 智能排序对子目录同样生效（卷序：第一卷/第四卷/第十卷）", async () => {
    const ctx = getNovelMasterTestContext();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/vols/第十卷/a.md", "A");
    await gvfs.write("/vols/第四卷/a.md", "A");
    await gvfs.write("/vols/第一卷/a.md", "A");

    const wt = createWorkplaceService(ctx.conn, { kind: "global" });
    await wt.setDirRule({
      logicalPath: "/vols",
      ruleEnabled: true,
      sortField: "smart",
      sortOrder: "asc",
      headCount: 0,
      tailCount: 0,
      fillPolicy: "hidden",
    });
    const rows = await wt.buildListRows();
    const dirPaths = rows
      .filter((r) => r.kind === "dir" && r.path.startsWith("/vols/"))
      .map((r) => r.path);
    assert.deepEqual(dirPaths, [
      "/vols/第一卷",
      "/vols/第四卷",
      "/vols/第十卷",
    ]);
  });
});
