/**
 * user-ops-operation-log：T-UOL3 / T-UOL6 / T-UOL11 及 store / parse 雏形。
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildUserOpsAttachmentFromLogEntry,
  chipsFromUserOpsLogStore,
  createUserVfsTurnServiceBundle,
  listUserOpsLog,
  parseUserOpsLogFromAttachments,
  projectComposerStatusAttachments,
  resetUserOpsLogStoreForTests,
} from "@novel-master/core/chat";
import { buildUserVfsSaveOp } from "../../src/service/vfs/build-user-vfs-turn-op.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

beforeEach(() => {
  resetUserOpsLogStoreForTests();
});

function writeOp(path: string, content: string, toolId = "tu_write") {
  return {
    actionXml: `<action name="write">\n${JSON.stringify({ path, content }, null, 2)}\n</action>`,
    tools: [
      {
        id: toolId,
        name: "write",
        input: { path, content },
      },
    ],
  };
}

describe("user-ops-operation-log (T-UOL*)", () => {
  it("T-UOL3：单次 save 多 hunk → 一条 edit，hunks.length ≥ 2", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const baseline =
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n";
    const saved =
      "line1-x\nline2\nline3\nline4\nline5\nline6\nline7\nline8-y\n";

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/multi.md", baseline, "tu_base"),
    );
    // 先 flush 掉 create，再测纯 edit multi-hunk
    await userVfsTurn.flushPendingUserVfsTurns(session.id);

    const saveOp = buildUserVfsSaveOp(baseline, saved, "/multi.md", saved);
    assert.ok(saveOp);
    assert.equal(saveOp!.tools[0]?.name, "edit");
    assert.ok(saveOp!.tools.length >= 2, "须多段 edit tool");

    await userVfsTurn.executeOp(session.id, saveOp!);
    const logs = listUserOpsLog(session.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.action, "edit");
    if (logs[0]!.action === "edit") {
      assert.ok(logs[0]!.hunks.length >= 2);
    }
  });

  it("T-UOL6：同 path 两条日志 → 一颗 chip；发送仍两条附件", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/agg.md", "v1", "tu_1"),
    );
    await userVfsTurn.executeOp(
      session.id,
      writeOp("/agg.md", "v2", "tu_2"),
    );

    assert.equal(listUserOpsLog(session.id).length, 2);
    const chips = chipsFromUserOpsLogStore(session.id);
    assert.equal(chips.length, 1);
    assert.equal(chips[0]!.path, "/agg.md");
    assert.equal(chips[0]!.action, "write");

    const projected = await projectComposerStatusAttachments(session.id, {});
    assert.equal(projected.length, 1);

    const flush = await userVfsTurn.flushPendingUserVfsTurns(session.id);
    assert.equal(flush.attachments.length, 2);
  });

  it("T-UOL11：noop save 不 append", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const body = "same\n";
    await userVfsTurn.executeOp(session.id, writeOp("/noop.md", body));
    await userVfsTurn.flushPendingUserVfsTurns(session.id);

    const noop = buildUserVfsSaveOp(body, body, "/noop.md", body);
    assert.equal(noop, null);
    assert.equal(listUserOpsLog(session.id).length, 0);
  });

  it("parseUserOpsLogFromAttachments：每附件一条；多 edit 合并 hunks", () => {
    const att = buildUserOpsAttachmentFromLogEntry({
      id: "uol-1",
      createdAtMs: 1,
      actionXml:
        `<action name="edit">\n${JSON.stringify({ path: "/e.md", oldString: "a", newString: "b" }, null, 2)}\n</action>\n` +
        `<action name="edit">\n${JSON.stringify({ path: "/e.md", oldString: "c", newString: "d" }, null, 2)}\n</action>`,
      action: "edit",
      path: "/e.md",
      hunks: [
        { oldString: "a", newString: "b" },
        { oldString: "c", newString: "d" },
      ],
    });
    const parsed = parseUserOpsLogFromAttachments([att]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.action, "edit");
    if (parsed[0]!.action === "edit") {
      assert.equal(parsed[0]!.hunks.length, 2);
    }
  });
});
