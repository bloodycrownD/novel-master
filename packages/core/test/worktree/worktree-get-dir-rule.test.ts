import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorktreeService } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("worktree getDirRule", () => {
  it("returns undefined when no rule exists and persisted fields when set", async () => {
    const ctx = await openNovelMasterTestConnection();
    const wt = createWorktreeService(ctx.conn, { kind: "global" });
    const path = "/template/my-dir";

    assert.equal(await wt.getDirRule(path), undefined);

    await wt.setDirRule({
      logicalPath: path,
      sortField: "updated",
      sortOrder: "desc",
      headCount: 2,
      tailCount: 3,
      fillPolicy: "header",
    });

    const rule = await wt.getDirRule(path);
    assert.ok(rule);
    assert.equal(rule.logicalPath, path);
    assert.equal(rule.sortField, "updated");
    assert.equal(rule.sortOrder, "desc");
    assert.equal(rule.headCount, 2);
    assert.equal(rule.tailCount, 3);
    assert.equal(rule.fillPolicy, "header");
    assert.equal(rule.ruleEnabled, true);

    await ctx.conn.close();
  });
});
