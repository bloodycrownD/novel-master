import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/errors/provider-errors.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { OpenAiProtocolAdapter } from "../../src/infra/llm-protocol/impl/openai.adapter.js";

describe("OpenAiProtocolAdapter HTTP", () => {
  it("listModels uses GET /models with bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ id: "gpt-4o" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.listModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    assert.equal(calls[0]!.url, "https://api.openai.com/v1/models");
    assert.equal(calls[0]!.init.method, "GET");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test");
    assert.equal(result.models[0]?.vendorModelId, "gpt-4o");
  });

  it("O4: chat sends tools and tool_choice in request body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "ok",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "hello",
      system: "You are helpful",
      tools: [
        {
          name: "vfs.read",
          description: "read file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    assert.equal(calls.length, 1);
    const parsed = JSON.parse(calls[0]!.body) as {
      messages?: unknown[];
      tools?: unknown[];
      tool_choice?: string;
    };
    assert.equal(parsed.tool_choice, "auto");
    assert.ok(Array.isArray(parsed.tools));
    assert.equal((parsed.tools as unknown[]).length, 1);
    const firstMsg = (parsed.messages as Array<{ role: string }>)[0];
    assert.equal(firstMsg?.role, "system");
  });

  it("O4b: OPENAI_TOOL_CHOICE_REQUIRED=1 sends tool_choice required", async () => {
    const prev = process.env.OPENAI_TOOL_CHOICE_REQUIRED;
    process.env.OPENAI_TOOL_CHOICE_REQUIRED = "1";
    try {
      const calls: Array<{ body: string }> = [];
      const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
        calls.push({ body: String(init?.body ?? "") });
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "ok" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
      await adapter.chat({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        vendorModelId: "gpt-4o",
        userContent: "hello",
        tools: [
          {
            name: "vfs.write",
            description: "write file",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      });

      const parsed = JSON.parse(calls[0]!.body) as { tool_choice?: string };
      assert.equal(parsed.tool_choice, "required");
    } finally {
      if (prev === undefined) {
        delete process.env.OPENAI_TOOL_CHOICE_REQUIRED;
      } else {
        process.env.OPENAI_TOOL_CHOICE_REQUIRED = prev;
      }
    }
  });

  it("O5: stream emits text-delta and done", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchFn = mock.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const deltas: string[] = [];
    let done = false;
    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "hi",
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
        if (ev.type === "done") {
          done = true;
        }
      },
    });

    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(result.assistantText, "Hello");
    assert.ok(done);
  });

  it("M1: stream accumulates delta.tool_calls by index", async () => {
    const chunk1 = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "vfs.read", arguments: '{"path":' },
              },
            ],
          },
        },
      ],
    };
    const chunk2 = {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"/tmp/x"}' } }],
          },
        },
      ],
    };
    const sse = [
      `data: ${JSON.stringify(chunk1)}`,
      "",
      `data: ${JSON.stringify(chunk2)}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchFn = mock.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> =
      [];
    let done = false;
    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "read file",
      stream: true,
      tools: [{ name: "vfs.read", description: "read", inputSchema: {} }],
      onStream: (ev) => {
        if (ev.type === "tool-use") {
          toolUses.push({ id: ev.id, name: ev.name, input: ev.input });
        }
        if (ev.type === "done") {
          done = true;
        }
      },
    });

    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0]!.name, "vfs.read");
    assert.equal(toolUses[0]!.input.path, "/tmp/x");
    const toolBlock = result.blocks.find((b) => b.type === "tool_use");
    assert.ok(toolBlock && toolBlock.type === "tool_use");
    assert.equal(toolBlock.name, "vfs.read");
    assert.equal((toolBlock as { input: Record<string, unknown> }).input.path, "/tmp/x");
    assert.ok(done);
  });

  it("O6: history with image maps to vision content in POST body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "seen" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const history: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            { type: "text", text: "what is this?" },
            {
              type: "image",
              source: { kind: "url", url: "https://example.com/a.png" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "ignored",
      history,
      tools: [{ name: "t", description: "d", inputSchema: {} }],
    });

    const parsed = JSON.parse(calls[0]!.body) as {
      messages?: Array<{ role: string; content: unknown }>;
    };
    const userMsg = parsed.messages?.find((m) => m.role === "user");
    assert.ok(userMsg);
    const content = userMsg!.content as Array<{ type: string; image_url?: { url: string } }>;
    assert.ok(Array.isArray(content));
    assert.equal(content[1]!.type, "image_url");
    assert.equal(content[1]!.image_url!.url, "https://example.com/a.png");
  });

  it("text-only shortcut still uses single user message", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      vendorModelId: "gpt-4o",
      userContent: "ping",
    });

    const parsed = JSON.parse(calls[0]!.body) as {
      messages?: Array<{ role: string; content: string }>;
    };
    assert.equal(parsed.messages?.length, 1);
    assert.equal(parsed.messages?.[0]?.role, "user");
    assert.equal(parsed.messages?.[0]?.content, "ping");
    assert.equal(result.assistantText, "pong");
  });

  it("rejects thinking in full mapper path", async () => {
    const adapter = new OpenAiProtocolAdapter(async () => new Response("{}"));
    const history: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        seq: 1,
        role: "assistant",
        content: { blocks: [{ type: "thinking", text: "secret" }] },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    await assert.rejects(
      () =>
        adapter.chat({
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
          vendorModelId: "gpt-4o",
          userContent: "hi",
          history,
          tools: [{ name: "t", description: "d", inputSchema: {} }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "UNSUPPORTED_CONTENT");
        return true;
      },
    );
  });
});
