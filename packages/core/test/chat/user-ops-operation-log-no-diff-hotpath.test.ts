/**
 * T-UOL12：手改投影 / flush 路径不调用 `diffWorkspaceForUserVfsFlush`（spy）。
 *
 * 须在 import 服务前 mock 净 diff 模块，故独立成文件。
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it, mock } from "node:test";

const diffSpy = mock.fn(() => {
  throw new Error(
    "diffWorkspaceForUserVfsFlush must not be called on project/flush",
  );
});

mock.module(
  "../../src/domain/chat/logic/diff-workspace-for-user-vfs-flush.js",
  {
    namedExports: {
      diffWorkspaceForUserVfsFlush: diffSpy,
      collectUserOpsChangedPaths: () => [],
      isWorkspaceFlushDiffEmpty: () => true,
    },
  },
);

const {
  createUserVfsTurnServiceBundle,
  projectComposerStatusAttachments,
  resetUserOpsLogStoreForTests,
} = await import("@novel-master/core/chat");
const {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} = await import("../helpers/novel-master-fixture.js");

novelMasterTestFixture();

beforeEach(() => {
  resetUserOpsLogStoreForTests();
  diffSpy.mock.resetCalls();
});

after(() => {
  mock.restoreAll();
});

describe("T-UOL12 no net-diff hot path", () => {
  it("投影与 flush 不调用 diffWorkspaceForUserVfsFlush", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const op = {
      actionXml: `<action name="write">\n${JSON.stringify({ path: "/spy.md", content: "x" }, null, 2)}\n</action>`,
      tools: [
        {
          id: "tu_spy",
          name: "write",
          input: { path: "/spy.md", content: "x" },
        },
      ],
    };
    const exec = await userVfsTurn.executeOp(session.id, op);
    assert.equal(exec.ok, true);

    const projected = await projectComposerStatusAttachments(session.id, {});
    assert.equal(projected.length, 1);

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.flushed, true);
    assert.equal(flush.attachments.length, 1);

    // deprecated stub 亦不走净 diff
    assert.deepEqual(await userVfsTurn.previewUserOpsActions(session.id), []);
    assert.deepEqual(
      await userVfsTurn.previewUserOpsChangedPaths(session.id),
      [],
    );

    assert.equal(diffSpy.mock.callCount(), 0);
  });
});
