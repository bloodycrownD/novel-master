import { unwrap } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatAgentSession, InMemoryAgentSession } from "@novel-master/core/agent";

import { textBlocks } from "@novel-master/core/chat";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("InMemoryAgentSession", () => {
  it("append/list preserves order", async () => {
    const session = new InMemoryAgentSession();
    unwrap(await session.append("user", textBlocks("a")));
    unwrap(await session.append("assistant", textBlocks("b")));
    const list = await session.list();
    assert.equal(list.length, 2);
    assert.equal(list[0]!.role, "user");
    assert.equal(list[1]!.role, "assistant");
  });

  it("hideRange hides messages from list", async () => {
    const session = new InMemoryAgentSession();
    unwrap(await session.append("user", textBlocks("1")));
    unwrap(await session.append("user", textBlocks("2")));
    unwrap(await session.append("user", textBlocks("3")));
    const count = unwrap(await session.hideRange(1, 2));
    assert.equal(count, 2);
    const list = await session.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.seq, 3);
  });
});

describe("ChatAgentSession", () => {
  it("append is visible via MessageService", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const chatSession = unwrap(await ctx.sessions.create(project.id));
    const agentSession = new ChatAgentSession(ctx.messages, chatSession.id);
    unwrap(await agentSession.append("assistant", {
      blocks: [
        {
          type: "tool_use",
          id: "tu1",
          name: "read",
          input: { path: "/a.txt" },
        },
      ],
    }));
    const all = await ctx.messages.listBySession(chatSession.id);
    const toolUse = all
      .flatMap((m) => m.content.blocks)
      .find((b) => b.type === "tool_use");
    assert.ok(toolUse);
  });

  it("list() 可见-only：hidden 行不进，行为与旧「全量 + filter(!hidden)」逐条等价", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-list-${testIsolationSuffix()}`));
    const chatSession = unwrap(await ctx.sessions.create(project.id));
    const agentSession = new ChatAgentSession(ctx.messages, chatSession.id);
    unwrap(await agentSession.append("user", textBlocks("visible-1")));
    unwrap(await agentSession.append("assistant", textBlocks("hidden-1")));
    const hiddenTail = unwrap(await agentSession.append("assistant", textBlocks("hidden-2")));
    unwrap(await agentSession.append("user", textBlocks("visible-2")));
    // 压缩/置位同款：隐藏中间与尾部两段
    assert.equal(unwrap(await agentSession.hideRange(2, hiddenTail.seq)), 2);

    // 牙齿：全量读确实含 hidden 行（不是「库里本来就没有」的恒真断言）
    const all = await ctx.messages.listBySession(chatSession.id);
    assert.equal(all.length, 4);
    assert.equal(all.filter((m) => m.hidden).length, 2);

    const list = await agentSession.list();
    assert.deepEqual(
      list.map((m) => m.seq),
      [1, 4],
      "list() 只回可见行且保持 seq 升序"
    );
    assert.ok(list.every((m) => !m.hidden));
    // 与旧实现（全量 filter）逐条等价：id / seq / role / 正文全等
    assert.deepEqual(list, all.filter((m) => !m.hidden));
  });
});
