import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorktreeService } from "@novel-master/core/worktree";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("worktree rule engine (integration)", () => {
  it("T-WEC15：service materializeLiveView 与 RuleEngine 同源 enum 行", async () => {
    const testCtx = getNovelMasterTestContext();
    const project = await testCtx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = testCtx.projectVfs(project.id);
    await pvfs.write("/parity/a.md", "A");
    await pvfs.write("/parity/b.md", "B");

    const wt = createWorktreeService(testCtx.conn, {
      kind: "project",
      projectId: project.id,
    });
    await wt.setFileRule({
      logicalPath: "/parity/a.md",
      inclusionMode: "show",
    });

    const live = await wt.materializeLiveView();
    const dirRoot = live.listRows.find((r) => r.kind === "dir" && r.path === "/");
    assert.ok(dirRoot);
    assert.equal(dirRoot.ruleState, "rule_on");

    const fileRow = live.listRows.find(
      (r) => r.kind === "file" && r.path === "/parity/a.md",
    );
    assert.ok(fileRow && fileRow.kind === "file");
    assert.equal(fileRow.inclusionMode, "show");
    assert.equal(fileRow.displayState, "full");
  });
});
