import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenAiProtocolAdapter } from "../../../src/infra/llm-protocol/impl/openai.adapter.js";
import { mock } from "node:test";

describe("OpenAI GLM thinking wire", () => {
  it("text-only 路径在 GLM-4.7 且 thinking 关闭时仍写入 disable", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: "k",
      vendorModelId: "glm-4.7",
      userContent: "hi",
    });

    assert.deepEqual(captured.thinking, { type: "disabled" });
    assert.equal(captured.enable_thinking, false);
  });
});
