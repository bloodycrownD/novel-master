import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/impl/anthropic.adapter.js";
import { OpenAiProtocolAdapter } from "../../src/infra/llm-protocol/impl/openai.adapter.js";
import { GeminiProtocolAdapter } from "../../src/infra/llm-protocol/impl/gemini.adapter.js";
import { ToolRegistry, registerBuiltinTools } from "@novel-master/core";

import { toolsFromRegistry } from "@novel-master/core/provider";

describe("ModelRequest tools + stream (adapters)", () => {
  it("Anthropic chat sends tools in request body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "key",
      vendorModelId: "claude-3-5-sonnet",
      userContent: "hi",
      system: "You are helpful",
      tools: [
        {
          name: "read",
          description: "read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    assert.equal(calls.length, 1);
    const parsed = JSON.parse(calls[0]!.body) as {
      system?: string;
      tools?: unknown[];
    };
    assert.equal(parsed.system, "You are helpful");
    assert.ok(Array.isArray(parsed.tools));
    assert.equal((parsed.tools as unknown[]).length, 1);
  });

  it("Anthropic stream emits text-delta and done", async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      "",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");

    const fetchFn = mock.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const deltas: string[] = [];
    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "key",
      vendorModelId: "claude",
      userContent: "hi",
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    });

    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(result.assistantText, "Hi");
  });

  it("OpenAI chat sends tools in request body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read",
                      arguments: '{"path":"/a"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      vendorModelId: "gpt-4",
      userContent: "hi",
      system: "sys",
      tools: [
        {
          name: "read",
          description: "read",
          inputSchema: { type: "object" },
        },
      ],
    });

    const parsed = JSON.parse(calls[0]!.body) as { tools?: unknown[]; tool_choice?: string };
    assert.ok(Array.isArray(parsed.tools));
    assert.equal(parsed.tool_choice, "auto");
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0]!.type, "tool_use");
  });

  it("OpenAI stream emits text-delta and done", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
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
    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      vendorModelId: "gpt-4",
      userContent: "hi",
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    });

    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(result.assistantText, "Hi");
  });

  it("Gemini stream emits text-delta and done", async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}',
      "",
    ].join("\n");

    const fetchFn = mock.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const deltas: string[] = [];
    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "k",
      vendorModelId: "gemini-2.0-flash",
      userContent: "hi",
      stream: true,
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    });

    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(result.assistantText, "Hi");
  });

  it("Gemini chat sends tools in request body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "k",
      vendorModelId: "gemini",
      userContent: "hi",
      tools: [{ name: "read", description: "read", inputSchema: { type: "object" } }],
    });

    const parsed = JSON.parse(calls[0]!.body) as {
      tools?: Array<{ functionDeclarations?: unknown[] }>;
    };
    assert.ok(Array.isArray(parsed.tools));
    assert.equal(parsed.tools![0]!.functionDeclarations!.length, 1);
  });

  it("toolsFromRegistry produces serializable schemas", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const tools = toolsFromRegistry(registry);
    assert.ok(tools.length >= 6);
    for (const t of tools) {
      assert.equal(typeof t.name, "string");
      assert.equal(typeof t.description, "string");
      assert.equal(typeof t.inputSchema, "object");
      assert.ok(JSON.stringify(t.inputSchema).length > 2);
    }
  });
});
