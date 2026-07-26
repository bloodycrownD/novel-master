/**
 * user-ops-operation-log：T-UOL3 / T-UOL6 / T-UOL10 / T-UOL11 及 store / parse 雏形。
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildUserOpsAttachmentFromLogEntry,
  chipsFromUserOpsLogStore,
  createUserVfsTurnServiceBundle,
  formatStatusChipLabel,
  formatStatusChipLabelFromAttachment,
  listUserOpsLog,
  parseUserOpsLogFromAttachments,
  projectComposerStatusAttachments,
  replaceUserOpsLog,
  resetUserOpsLogStoreForTests,
} from "@novel-master/core/chat";
import {
  buildUserVfsRenameOp,
  buildUserVfsSaveOp,
} from "../../src/service/vfs/build-user-vfs-turn-op.js";
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

  it("rename/move：同目录 rename、跨目录 move；chip 自描述；旧跨目录 rename XML normalize 为 move", async () => {
    const ctx = getNovelMasterTestContext();
    const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await userVfsTurn.executeOp(
      session.id,
      writeOp("/a.md", "x", "tu_a"),
    );
    await userVfsTurn.executeOp(
      session.id,
      writeOp("/b.md", "y", "tu_b"),
    );
    await userVfsTurn.flushPendingUserVfsTurns(session.id);

    await userVfsTurn.executeOp(
      session.id,
      buildUserVfsRenameOp("/a.md", "/a2.md"),
    );
    await userVfsTurn.executeOp(
      session.id,
      buildUserVfsRenameOp("/b.md", "/dir/b.md"),
    );

    const logs = listUserOpsLog(session.id);
    assert.equal(logs.length, 2);
    assert.equal(logs[0]!.action, "rename");
    assert.equal(logs[1]!.action, "move");
    assert.match(logs[0]!.actionXml, /name="rename"/);
    assert.match(logs[1]!.actionXml, /name="move"/);

    const chips = chipsFromUserOpsLogStore(session.id);
    assert.equal(chips.length, 2);
    const renameChip = chips.find((c) => c.path === "/a2.md");
    const moveChip = chips.find((c) => c.path === "/dir/b.md");
    assert.ok(renameChip);
    assert.ok(moveChip);
    assert.equal(renameChip!.action, "rename");
    assert.equal(moveChip!.action, "move");
    assert.equal(renameChip!.name, "/a2.md");
    assert.equal(moveChip!.name, "/dir/b.md");
    assert.equal(
      formatStatusChipLabelFromAttachment(renameChip!),
      "改名:/a2.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment(moveChip!),
      "移动:/dir/b.md",
    );

    // 旧跨目录 rename XML → parse normalize 为 move
    const legacyMoveXml =
      '<action name="rename">\n{"from":"/old.md","to":"/dir/new.md"}\n</action>';
    const parsed = parseUserOpsLogFromAttachments([
      {
        name: "/dir/new.md",
        source: "user_ops",
        type: "text",
        content: legacyMoveXml,
        path: "/dir/new.md",
        action: "rename",
      },
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.action, "move");
    assert.equal(parsed[0]!.oldPath, "/old.md");
    assert.equal(parsed[0]!.newPath, "/dir/new.md");
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

  it("T-UOL10：旧合成 XML parse 不抛；损坏条跳过；chip write/mkdir→创建", () => {
    const legacyMkdirXml = `<action name="mkdir">\n${JSON.stringify({ path: "/notes" }, null, 2)}\n</action>`;
    const legacyWriteXml = `<action name="write">\n${JSON.stringify({ path: "/notes/a.md", content: "hello" }, null, 2)}\n</action>`;
    // 旧净 diff 合成：同附件内多段 action（mkdir + write）
    const legacyComboXml = `${legacyMkdirXml}\n${legacyWriteXml}`;

    const mkdirAtt = {
      name: "/notes",
      source: "user_ops" as const,
      type: "text" as const,
      content: legacyMkdirXml,
      path: "/notes",
      action: "mkdir" as const,
    };
    const writeAtt = {
      name: "/notes/a.md",
      source: "user_ops" as const,
      type: "text" as const,
      content: legacyWriteXml,
      path: "/notes/a.md",
      action: "write" as const,
    };
    const comboAtt = {
      name: "/notes",
      source: "user_ops" as const,
      type: "text" as const,
      content: legacyComboXml,
      path: "/notes",
    };
    const brokenAtt = {
      name: "__broken__",
      source: "user_ops" as const,
      type: "text" as const,
      // 无合法 action 标签 → handOps 空 → 跳过
      content: "not-an-action-xml {{{",
    };
    const brokenEmptyPathAtt = {
      name: "__no_path__",
      source: "user_ops" as const,
      type: "text" as const,
      // JSON 损坏且无 att.path → write path 空 → 跳过
      content: '<action name="write">\n{not-json\n</action>',
    };

    let parsed;
    assert.doesNotThrow(() => {
      parsed = parseUserOpsLogFromAttachments([
        mkdirAtt,
        writeAtt,
        comboAtt,
        brokenAtt,
        brokenEmptyPathAtt,
      ]);
    });
    assert.ok(parsed!);
    // 损坏条跳过；mkdir / write / combo(首条 mkdir) 各映回一条
    assert.equal(parsed!.length, 3);
    assert.equal(parsed![0]!.action, "mkdir");
    assert.equal(parsed![1]!.action, "write");
    assert.equal(parsed![2]!.action, "mkdir");

    assert.equal(formatStatusChipLabel("write", "/a.md"), "创建:/a.md");
    assert.equal(formatStatusChipLabel("mkdir", "/dir"), "创建:/dir");
    assert.equal(
      formatStatusChipLabelFromAttachment(mkdirAtt),
      "创建:/notes",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment(writeAtt),
      "创建:/notes/a.md",
    );

    // Undo 映回 store 后 chip 文案亦为「创建」
    const sessionId = `t-uol10-${testIsolationSuffix()}`;
    replaceUserOpsLog(sessionId, parsed!);
    const chips = chipsFromUserOpsLogStore(sessionId);
    assert.ok(chips.some((c) => c.action === "mkdir"));
    assert.ok(chips.some((c) => c.action === "write"));
    for (const chip of chips) {
      if (chip.action === "mkdir" || chip.action === "write") {
        assert.match(
          formatStatusChipLabelFromAttachment(chip),
          /^创建:/,
        );
      }
    }
  });
});
