/**
 * hide-message.handler 端到端 fixture 测（resolveHideMessageRange 锚点）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "../../src/domain/chat/content/text-blocks.js";
import { messageIdsInSlice } from "../../src/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "../../src/domain/depth/logic/depth-from-tail.js";
import { resolveHideMessageRange } from "../../src/domain/depth/logic/resolve-hide-message-range.js";
import { ChatAgentSession } from "../../src/service/agent/impl/chat-agent-session.js";
import { runHideMessageAction } from "../../src/service/events/impl/actions/hide-message.handler.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

async function appendText(
  session: ChatAgentSession,
  role: string,
  text: string,
): Promise<void> {
  await session.append(role, textBlocks(text));
}

describe("runHideMessageAction", () => {
  it("startDepth=6 无 endDepth 且 depth6 为 user 时锚定 assistant 起点", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const chatSession = new ChatAgentSession(ctx.messages, sessionRow.id);

    await appendText(chatSession, "user", "u1");
    await appendText(chatSession, "assistant", "a1");
    await appendText(chatSession, "user", "u2");
    await appendText(chatSession, "user", "u3");
    await appendText(chatSession, "assistant", "a2");
    await appendText(chatSession, "assistant", "a3");
    await appendText(chatSession, "assistant", "a4");
    await appendText(chatSession, "assistant", "a5");
    await appendText(chatSession, "assistant", "a6");
    await appendText(chatSession, "assistant", "a7");

    const slice = { startDepth: 6 };
    const all = await ctx.messages.listBySession(sessionRow.id);
    const visible = listVisibleForDepth(all);
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);

    await runHideMessageAction(
      chatSession,
      sessionRow.id,
      slice,
      { messages: ctx.messages },
    );

    const list = await ctx.messages.listBySession(sessionRow.id);
    for (const message of list) {
      const hidden =
        message.seq >= range.fromSeq && message.seq <= range.toSeq;
      assert.equal(message.hidden, hidden, `seq ${message.seq}`);
    }
  });

  it("有 endDepth 时仍 hide slice 内 min~max seq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const sessionRow = await ctx.sessions.create(project.id);
    const chatSession = new ChatAgentSession(ctx.messages, sessionRow.id);

    await appendText(chatSession, "assistant", "a1");
    await appendText(chatSession, "user", "u1");
    await appendText(chatSession, "assistant", "a2");
    await appendText(chatSession, "user", "u2");
    await appendText(chatSession, "assistant", "a3");

    const slice = { startDepth: 2, endDepth: 4 };
    const all = await ctx.messages.listBySession(sessionRow.id);
    const visible = listVisibleForDepth(all);
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);

    await runHideMessageAction(
      chatSession,
      sessionRow.id,
      slice,
      { messages: ctx.messages },
    );

    const list = await ctx.messages.listBySession(sessionRow.id);
    for (const message of list) {
      const hidden =
        message.seq >= range.fromSeq && message.seq <= range.toSeq;
      assert.equal(message.hidden, hidden, `seq ${message.seq}`);
    }
  });
});
