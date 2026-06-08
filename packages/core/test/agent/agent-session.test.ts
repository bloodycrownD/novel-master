import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ChatAgentSession,
  InMemoryAgentSession,
  textBlocks,
} from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("InMemoryAgentSession", () => {
  it("append/list preserves order", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("a"));
    await session.append("assistant", textBlocks("b"));
    const list = await session.list();
    assert.equal(list.length, 2);
    assert.equal(list[0]!.role, "user");
    assert.equal(list[1]!.role, "assistant");
  });

  it("hideRange hides messages from list", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("1"));
    await session.append("user", textBlocks("2"));
    await session.append("user", textBlocks("3"));
    const count = await session.hideRange(1, 2);
    assert.equal(count, 2);
    const list = await session.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.seq, 3);
  });
});

describe("ChatAgentSession", () => {
  it("append is visible via MessageService", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const chatSession = await ctx.sessions.create(project.id);
    const agentSession = new ChatAgentSession(ctx.messages, chatSession.id);
    await agentSession.append("assistant", {
      blocks: [
        {
          type: "tool_use",
          id: "tu1",
          name: "read",
          input: { path: "/a.txt" },
        },
      ],
    });
    const all = await ctx.messages.listBySession(chatSession.id);
    const toolUse = all
      .flatMap((m) => m.content.blocks)
      .find((b) => b.type === "tool_use");
    assert.ok(toolUse);
    await ctx.conn.close();
  });
});
