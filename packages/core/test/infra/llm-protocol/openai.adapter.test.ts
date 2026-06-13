import assert from "node:assert/strict";
import { after, describe, it, mock } from "node:test";

const sseChunks = [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
  "data: [DONE]\n\n",
];

const postSseMock = mock.fn(
  async (
    _url: string,
    _init: RequestInit,
    onChunk: (chunk: string) => void,
  ): Promise<{ status: number; contentType: string | null }> => {
    for (const chunk of sseChunks) {
      onChunk(chunk);
    }
    return { status: 200, contentType: "text/event-stream" };
  },
);

mock.module("../../../src/infra/llm-protocol/logic/llm-sse-transport.js", {
  namedExports: {
    postSse: postSseMock,
  },
});

const { OpenAiProtocolAdapter } = await import(
  "../../../src/infra/llm-protocol/impl/openai.adapter.js"
);

after(() => {
  mock.restoreAll();
});

describe("OpenAiProtocolAdapter chatStream", () => {
  it("ADAPTER-01: mock postSse delivers incremental onStream and final done with blocks/usage", async () => {
    const textDeltas: string[] = [];
    let doneEvent:
      | { readonly type: "done"; readonly result: { assistantText: string } }
      | undefined;

    const adapter = new OpenAiProtocolAdapter(async () => {
      throw new Error("fetch must not be called when postSse is mocked");
    });

    const result = await adapter.chat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "hi",
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          textDeltas.push(ev.text);
        }
        if (ev.type === "done") {
          doneEvent = ev;
        }
      },
    });

    assert.equal(postSseMock.mock.calls.length, 1);
    const [url, init, onChunkHandler] = postSseMock.mock.calls[0]!.arguments;
    assert.equal(url, "https://api.example.com/v1/chat/completions");
    assert.equal((init as RequestInit).method, "POST");
    assert.equal(typeof onChunkHandler, "function");

    const body = JSON.parse(String((init as RequestInit).body)) as {
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
    };
    assert.equal(body.stream, true);
    assert.equal(body.stream_options?.include_usage, true);

    assert.deepEqual(textDeltas, ["Hel", "lo"]);
    assert.equal(result.assistantText, "Hello");
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0]!.type, "text");
    if (result.blocks[0]!.type === "text") {
      assert.equal(result.blocks[0].text, "Hello");
    }
    assert.deepEqual(result.usage, {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    });

    assert.ok(doneEvent);
    assert.equal(doneEvent!.type, "done");
    assert.equal(doneEvent!.result.assistantText, "Hello");
    assert.deepEqual(doneEvent!.result, result);
  });

  it("GLM 流式带 tools 时请求体包含 tool_stream=true", async () => {
    postSseMock.mock.resetCalls();
    const adapter = new OpenAiProtocolAdapter(async () => {
      throw new Error("fetch must not be called when postSse is mocked");
    });

    await adapter.chat({
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-test",
      vendorModelId: "glm-4.7",
      userContent: "hi",
      stream: true,
      tools: [
        {
          name: "write",
          description: "write file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    assert.equal(postSseMock.mock.calls.length, 1);
    const init = postSseMock.mock.calls[0]!.arguments[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      tool_stream?: boolean;
      tools?: unknown[];
      stream?: boolean;
    };
    assert.equal(body.stream, true);
    assert.ok(Array.isArray(body.tools));
    assert.equal(body.tool_stream, true);
  });

  it("非 GLM 流式带 tools 时不发送 tool_stream", async () => {
    postSseMock.mock.resetCalls();
    const adapter = new OpenAiProtocolAdapter(async () => {
      throw new Error("fetch must not be called when postSse is mocked");
    });

    await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "hi",
      stream: true,
      tools: [
        {
          name: "read",
          description: "read",
          inputSchema: { type: "object" },
        },
      ],
    });

    const init = postSseMock.mock.calls[0]!.arguments[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { tool_stream?: boolean };
    assert.equal(body.tool_stream, undefined);
  });
});
