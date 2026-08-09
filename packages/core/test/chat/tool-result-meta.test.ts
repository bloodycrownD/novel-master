/**
 * agent-subagent M1 / Step 4 (C5 + C36) ToolResultBlock.meta 持久化闭环测试。
 *
 * T-S5（P1-A）：写入 tool_result 带 meta.subagentSessionId 后，重读消息
 * （走 parseMessageContent 反序列化）仍能拿到同一个 subagentSessionId。
 *
 * 这里同时覆盖纯函数层（parseMessageContent）和集成层（messages service
 * 写 → list 读 → parseMessageContent）。
 *
 * @module test/chat/tool-result-meta.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { ToolResultBlock } from "@/domain/chat/model/content-block.js";
import { parseMessageContent } from "@/domain/chat/content/parse-message-content.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("ToolResultBlock.meta parse（C5 + C36）单元", () => {
  it("tool_result 带 meta.subagentSessionId round-trip", () => {
    const payload = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "子代理回流文本",
          meta: { subagentSessionId: "sess-child-001" },
        },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    assert.equal(parsed.blocks.length, 1);
    const block = parsed.blocks[0] as ToolResultBlock;
    assert.equal(block.type, "tool_result");
    assert.equal(block.meta?.subagentSessionId, "sess-child-001");
  });

  it("tool_result meta 不存在时 meta 为 undefined（老消息兼容）", () => {
    const payload = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "old",
          ok: true,
        },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    const block = parsed.blocks[0] as ToolResultBlock;
    assert.equal(block.meta, undefined);
  });

  it("tool_result meta 是对象但无 subagentSessionId 时 meta 为 undefined（未知字段静默忽略）", () => {
    const payload = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "x",
          meta: { unknownFutureField: "foo" },
        },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    const block = parsed.blocks[0] as ToolResultBlock;
    // subagentSessionId 缺失 → meta 折叠成 undefined（向前兼容）。
    assert.equal(block.meta, undefined);
  });

  it("tool_result meta.subagentSessionId 非字符串时抛 INVALID_ARGUMENT", () => {
    assert.throws(
      () =>
        parseMessageContent(
          JSON.stringify({
            blocks: [
              {
                type: "tool_result",
                toolUseId: "tu_1",
                content: "x",
                meta: { subagentSessionId: 123 },
              },
            ],
          }),
        ),
      /subagentSessionId must be a string/,
    );
  });

  it("tool_result meta 非对象时抛 INVALID_ARGUMENT", () => {
    assert.throws(
      () =>
        parseMessageContent(
          JSON.stringify({
            blocks: [
              {
                type: "tool_result",
                toolUseId: "tu_1",
                content: "x",
                meta: "not-an-object",
              },
            ],
          }),
        ),
      /meta must be an object/,
    );
  });

  it("meta 与 summary/ok 可同时存在", () => {
    const payload = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu_1",
          content: "ok body",
          ok: true,
          summary: "3 行",
          meta: { subagentSessionId: "child-1" },
        },
      ],
    };
    const parsed = parseMessageContent(JSON.stringify(payload));
    const block = parsed.blocks[0] as ToolResultBlock;
    assert.equal(block.ok, true);
    assert.equal(block.summary, "3 行");
    assert.equal(block.meta?.subagentSessionId, "child-1");
  });
});

describe("ToolResultBlock.meta 持久化闭环（T-S5，集成）", () => {
  it("messages.append 写入带 meta.subagentSessionId 的 tool_result，重读仍拿到同一值", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "main");

    const block: ToolResultBlock = {
      type: "tool_result",
      toolUseId: "tu_subagent_1",
      content: "子代理末条 assistant 文本回流",
      meta: { subagentSessionId: "sess-subagent-xyz" },
    };

    await ctx.messages.append(session.id, "user", { blocks: [block] });

    const list = await ctx.messages.listBySession(session.id);
    assert.equal(list.length, 1);
    const loaded = list[0]!;
    assert.equal(loaded.role, "user");
    const loadedBlock = loaded.content.blocks[0] as ToolResultBlock;
    assert.equal(loadedBlock.type, "tool_result");
    assert.equal(loadedBlock.meta?.subagentSessionId, "sess-subagent-xyz");
    assert.equal(loadedBlock.content, "子代理末条 assistant 文本回流");
  });

  it("子 agent 场景：createSubSession + append tool_result meta，闭环一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父");
    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "查大纲",
    );

    // 子 session 写一条 assistant 消息（模拟子 agent 跑完落库）。
    await ctx.messages.append(child.id, "assistant", textBlocks("子代理结果"));

    // 父 session 写一条 user 消息带 tool_result，meta.subagentSessionId 指向 child。
    const block: ToolResultBlock = {
      type: "tool_result",
      toolUseId: "tu_task_1",
      content: "子代理结果",
      meta: { subagentSessionId: child.id },
    };
    await ctx.messages.append(parent.id, "user", { blocks: [block] });

    const parentMessages = await ctx.messages.listBySession(parent.id);
    assert.equal(parentMessages.length, 1);
    const loaded = parentMessages[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(loaded.meta?.subagentSessionId, child.id);
  });
});
