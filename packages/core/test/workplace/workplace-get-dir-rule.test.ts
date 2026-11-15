import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { unwrap } from "../helpers/result-unwrap.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("worktree getDirRule", () => {
  it("returns undefined when no rule exists and persisted fields when set", async () => {
    const ctx = getNovelMasterTestContext();
    const wt = createWorkplaceService(ctx.conn, { kind: "global" });
    const path = "/my-dir";

    assert.equal(unwrap(await wt.getDirRule(path)), undefined);

    await wt.setDirRule({
      logicalPath: path,
      sortField: "updated",
      sortOrder: "desc",
      headCount: 2,
      tailCount: 3,
      fillPolicy: "header",
    });

    const rule = unwrap(await wt.getDirRule(path));
    assert.ok(rule);
    assert.equal(rule.logicalPath, path);
    assert.equal(rule.sortField, "updated");
    assert.equal(rule.sortOrder, "desc");
    assert.equal(rule.headCount, 2);
    assert.equal(rule.tailCount, 3);
    assert.equal(rule.fillPolicy, "header");
    assert.equal(rule.ruleEnabled, true);
  });
});
