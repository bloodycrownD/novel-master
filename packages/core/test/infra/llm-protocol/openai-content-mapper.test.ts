import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import {
  blocksToOpenAiMessageContent,
  chatMessagesToOpenAi,
  openAiChoiceToBlocks,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
import { applyThinkingContextForLlm } from "../../../src/service/prompt/apply-thinking-context-for-llm.js";

describe("openai-content-mapper", () => {
  it("O1: text + tool_use �?assistant message with tool_calls", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: {
          blocks: [
            { type: "text", text: "I'll read the file." },
            {
              type: "tool_use",
              id: "call_abc",
              name: "read",
              input: { path: "/tmp/a.txt" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "assistant");
    assert.equal(out[0]!.content, "I'll read the file.");
    const toolCalls = out[0]!.tool_calls as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]!.id, "call_abc");
    assert.equal(toolCalls[0]!.type, "function");
    assert.equal(toolCalls[0]!.function.name, "read");
    assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), {
      path: "/tmp/a.txt",
    });
  });

  it("O2: OpenAI tool_calls response �?tool_use blocks", () => {
    const blocks = openAiChoiceToBlocks({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_xyz",
          type: "function",
          function: {
            name: "write",
            arguments: '{"path":"/out.txt","content":"hi"}',
          },
        },
      ],
    });

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "tool_use");
    if (blocks[0]!.type !== "tool_use") {
      return;
    }
    assert.equal(blocks[0].id, "call_xyz");
    assert.equal(blocks[0].name, "write");
    assert.deepEqual(blocks[0].input, { path: "/out.txt", content: "hi" });
  });

  it("O3: tool_result �?role tool messages with tool_call_id", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_abc",
              content: "file contents here",
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "tool");
    assert.equal(out[0]!.tool_call_id, "call_abc");
    assert.equal(out[0]!.content, "file contents here");
  });

  it("R7: tool_result ok/summary metadata omitted from OpenAI POST body", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_abc",
              content: "file contents here",
              ok: true,
              summary: "30 lines",
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "tool");
    assert.equal(out[0]!.tool_call_id, "call_abc");
    assert.equal(out[0]!.content, "file contents here");
    assert.equal((out[0] as Record<string, unknown>).ok, undefined);
    assert.equal((out[0] as Record<string, unknown>).summary, undefined);
  });

  it("O6: image url block �?vision image_url part", () => {
    const content = blocksToOpenAiMessageContent([
      { type: "text", text: "describe this" },
      {
        type: "image",
        source: { kind: "url", url: "https://example.com/a.png" },
      },
    ]);
    assert.ok(Array.isArray(content));
    const parts = content as Array<{ type: string; image_url?: { url: string } }>;
    assert.equal(parts.length, 2);
    assert.equal(parts[1]!.type, "image_url");
    assert.equal(parts[1]!.image_url!.url, "https://example.com/a.png");
  });

  it("rejects thinking blocks outbound", () => {
    assert.throws(
      () =>
        blocksToOpenAiMessageContent([{ type: "thinking", text: "hmm" }]),
      (e: unknown) => e instanceof ProviderError && e.code === "UNSUPPORTED_CONTENT",
    );
  });

  it("maps reasoning_content inbound to thinking when content is present", () => {
    const blocks = openAiChoiceToBlocks({
      content: "answer",
      reasoning_content: "internal chain",
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "thinking");
    assert.equal(blocks[1]!.type, "text");
  });

  it("string content 含内嵌标签时原样进 text，不挖入 thinking", () => {
    const blocks = openAiChoiceToBlocks({
      content: "<thought>secret</thought>可见回复",
      reasoning_content: "structured",
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "thinking");
    assert.equal(blocks[1]!.type, "text");
    if (blocks[0]!.type === "thinking" && blocks[1]!.type === "text") {
      assert.equal(blocks[0].text, "structured");
      assert.equal(blocks[1].text, "<thought>secret</thought>可见回复");
    }
  });

  it("maps reasoning-only inbound to thinking only (no GLM promotion)", () => {
    const blocks = openAiChoiceToBlocks({
      content: "",
      reasoning_content: "visible reply",
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "thinking");
    if (blocks[0]!.type === "thinking") {
      assert.equal(blocks[0].text, "visible reply");
    }
  });

  // T-SR5：chatMessagesToOpenAi 丢弃无 content 且无 tool_calls 的空 user
  it("T-SR5: 跳过空正文且无 tool_calls 的 user（避免缺 content 触发 400）", () => {
    const messages: ChatMessage[] = [
      {
        id: "u0",
        sessionId: "s1",
        seq: 0,
        role: "user",
        content: { blocks: [{ type: "text", text: "" }] },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
      {
        id: "u1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: { blocks: [{ type: "text", text: "hi" }] },
        provider: null,
        raw: null,
        createdAtMs: 1,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "user");
    assert.equal(out[0]!.content, "hi");
  });

  // T-PM3：OpenAI 出站不做相邻 user 合并（零改动锁定）
  it("T-PM3: tool_result user + 纯文本 user 出站为 tool → user 两消息，不合并不报错", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_abc",
              content: "file contents here",
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
      {
        id: "u2",
        sessionId: "s1",
        seq: 2,
        role: "user",
        content: {
          blocks: [{ type: "text", text: "换个话题" }],
        },
        provider: null,
        raw: null,
        createdAtMs: 1,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.role, "tool");
    assert.equal(out[0]!.tool_call_id, "call_abc");
    assert.equal(out[1]!.role, "user");
    assert.equal(out[1]!.content, "换个话题");
  });

  it("RC1: assistant thinking 块以 reasoning_content 回传，正文进 content", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: {
          blocks: [
            { type: "thinking", text: "先分析一下…" },
            { type: "text", text: "回答" },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "assistant");
    assert.equal(out[0]!.reasoning_content, "先分析一下…");
    assert.equal(out[0]!.content, "回答");
  });

  it("RC2: 多个 thinking 块拼接为一条 reasoning_content；redacted_thinking 丢弃不进任何字段", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: {
          blocks: [
            { type: "thinking", text: "第一段。" },
            { type: "redacted_thinking", data: "opaque" },
            { type: "thinking", text: "第二段。" },
            { type: "tool_use", id: "call_1", name: "read", input: {} },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.reasoning_content, "第一段。第二段。");
    assert.ok(!JSON.stringify(out[0]).includes("opaque"));
    assert.equal(out[0]!.content, null);
  });

  it("RC3: 纯 thinking 的 assistant 消息不丢：content 置 null + reasoning_content 回传", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: { blocks: [{ type: "thinking", text: "只有思考" }] },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const out = chatMessagesToOpenAi(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.role, "assistant");
    assert.equal(out[0]!.reasoning_content, "只有思考");
    assert.equal(out[0]!.content, null);
  });

  it("RC4: 与全量保留联动：开态所有历史 thinking 均以 reasoning_content 回传；关态全剥时无 reasoning_content 字段", () => {
    const mk = (id: string, thinking: string): ChatMessage => ({
      id,
      sessionId: "s1",
      seq: 1,
      role: "assistant",
      content: {
        blocks: [
          { type: "thinking", text: thinking },
          { type: "text", text: "回答" },
        ],
      },
      provider: null,
      raw: null,
      createdAtMs: 0,
      hidden: false,
    });
    const userMsg = (id: string): ChatMessage => ({
      id,
      sessionId: "s1",
      seq: 1,
      role: "user",
      content: { blocks: [{ type: "text", text: "问" }] },
      provider: null,
      raw: null,
      createdAtMs: 0,
      hidden: false,
    });
    const history = [userMsg("u1"), mk("a1", "第一轮思考"), userMsg("u2"), mk("a2", "第二轮思考")];

    const onOut = chatMessagesToOpenAi(
      applyThinkingContextForLlm(history, {
        enabled: true,
        protocol: "openai",
        retainProtocolMinimum: true,
        requestThinkingEnabled: true,
      }),
    );
    assert.equal(onOut[1]!.reasoning_content, "第一轮思考");
    assert.equal(onOut[3]!.reasoning_content, "第二轮思考");

    const offOut = chatMessagesToOpenAi(
      applyThinkingContextForLlm(history, {
        enabled: false,
        protocol: "openai",
        retainProtocolMinimum: true,
        requestThinkingEnabled: true,
      }),
    );
    for (const message of offOut) {
      assert.equal(message.reasoning_content, undefined);
    }
  });
});
