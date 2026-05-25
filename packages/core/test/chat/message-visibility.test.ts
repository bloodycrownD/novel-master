/**
 * Message visibility (hidden field) tests.
 *
 * @module test/chat/message-visibility
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("Message visibility", () => {
  it("hides and shows a single message", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "msg1" });

    await ctx.messages.hide(m1.id);
    const hidden = await ctx.messages.get(m1.id);
    assert.equal(hidden.hidden, true);

    await ctx.messages.show(m1.id);
    const shown = await ctx.messages.get(m1.id);
    assert.equal(shown.hidden, false);

    await ctx.conn.close();
  });

  it("hides a range of messages by seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });
    await ctx.messages.append(session.id, "user", { content: "3" });
    await ctx.messages.append(session.id, "assistant", { content: "4" });

    const count = await ctx.messages.hideRange(session.id, 2, 3);
    assert.equal(count, 2);

    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false); // seq 1
    assert.equal(list[1]!.hidden, true); // seq 2
    assert.equal(list[2]!.hidden, true); // seq 3
    assert.equal(list[3]!.hidden, false); // seq 4

    await ctx.conn.close();
  });

  it("shows a range of messages by seq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "assistant", { content: "2" });

    await ctx.messages.hide(m1.id);
    await ctx.messages.hide(m2.id);

    const count = await ctx.messages.showRange(session.id, 1, 2);
    assert.equal(count, 2);

    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list[0]!.hidden, false);
    assert.equal(list[1]!.hidden, false);

    await ctx.conn.close();
  });

  it("fork preserves hidden state", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    const m2 = await ctx.messages.append(session.id, "assistant", { content: "2" });

    await ctx.messages.hide(m1.id);

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);

    assert.equal(forkedMsgs.length, 2);
    assert.equal(forkedMsgs[0]!.hidden, true); // m1 was hidden
    assert.equal(forkedMsgs[1]!.hidden, false); // m2 was visible

    await ctx.conn.close();
  });

  it("session copy preserves hidden state", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });

    await ctx.messages.hide(m1.id);

    const copy = await ctx.sessions.copy(session.id);
    const copyMsgs = await ctx.messages.listBySession(copy.id);

    assert.equal(copyMsgs.length, 2);
    assert.equal(copyMsgs[0]!.hidden, true); // m1 was hidden
    assert.equal(copyMsgs[1]!.hidden, false); // m2 was visible

    await ctx.conn.close();
  });

  it("hideRange returns 0 when fromSeq > toSeq", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });

    const count = await ctx.messages.hideRange(session.id, 5, 3);
    assert.equal(count, 0);

    await ctx.conn.close();
  });

  it("hideRange only affects existing messages", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    await ctx.messages.append(session.id, "user", { content: "1" });
    await ctx.messages.append(session.id, "assistant", { content: "2" });

    const count = await ctx.messages.hideRange(session.id, 1, 10);
    assert.equal(count, 2); // Only 2 messages exist

    await ctx.conn.close();
  });

  it("new messages are visible by default", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id, "S");
    const m1 = await ctx.messages.append(session.id, "user", { content: "msg1" });

    assert.equal(m1.hidden, false);

    await ctx.conn.close();
  });
});
