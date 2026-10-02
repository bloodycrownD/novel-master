/**
 * C1-9：anthropic `max_tokens` 硬上限 4096 吃掉全部输出预算。
 *
 * 修复前两处 4096/16000 各写一份又互相不知道，叠加 `effectiveMax - 1` 的钳制公式
 * ⇒ 默认配置下 thinking 占 4095、可见正文只剩 1 token，且 low/medium/high 三档全同。
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/impl/anthropic.adapter.js";
import { thinkingLevelToModelThinkingParams } from "../../src/domain/provider/logic/thinking-level-presets.js";
import { ANTHROPIC_BODY_DEFAULT_MAX_TOKENS } from "../../src/domain/provider/logic/resolve-thinking-wire.js";
import { ANTHROPIC_SAMPLING_DEFAULTS } from "../../src/domain/provider/model/protocol-sampling-defaults.js";
import type { SavedModelSamplingSettings } from "../../src/domain/provider/model/saved-model-settings.js";

const samplingOff: SavedModelSamplingSettings = { enabled: false };

/** 复用 T10 的 captured-body 写法（mock.fn fetch 捕获 anthropic body）。 */
async function captureAnthropicBody(
  req: {
    readonly sampling?: unknown;
    readonly thinking?: unknown;
  }
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  const fetchFn = mock.fn(async (_url, init) => {
    captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
  await adapter.chat({
    baseUrl: "https://api.anthropic.com",
    apiKey: "k",
    vendorModelId: "claude",
    userContent: "hi",
    ...(req.sampling != null ? { sampling: req.sampling } : {}),
    ...(req.thinking != null ? { thinking: req.thinking } : {}),
  } as Parameters<typeof adapter.chat>[0]);
  return captured;
}

describe("anthropic max_tokens / thinking budget", () => {
  it("T-AMT1 默认配置 body.max_tokens=16000、high 档 budget=12800、余额≥3200", async () => {
    const body = await captureAnthropicBody({
      sampling: { protocol: "anthropic", anthropic: {} },
      thinking: {
        protocol: "anthropic",
        anthropic: { type: "enabled", budget_tokens: 12800 },
      },
    });
    assert.equal(body.max_tokens, 16000);
    const thinking = body.thinking as { budget_tokens: number };
    assert.equal(thinking.budget_tokens, 12800);
    assert.ok(
      (body.max_tokens as number) - thinking.budget_tokens >= 3200,
      "可见正文必须有余额",
    );
  });

  it("T-AMT2 sampling 显式 max_tokens 优先且按 0.8 钳制", () => {
    const sampling: SavedModelSamplingSettings = {
      enabled: true,
      params: { protocol: "anthropic", anthropic: { max_tokens: 8000 } },
    };
    const params = thinkingLevelToModelThinkingParams(
      "high",
      "anthropic",
      "claude",
      sampling,
    );
    assert.equal(params?.protocol, "anthropic");
    if (params?.protocol !== "anthropic") throw new Error("unreachable");
    assert.equal(params.anthropic.budget_tokens, Math.floor(8000 * 0.8));
  });

  it("T-AMT3 max_tokens=1 时 budget 退到 1（不发非法请求）", () => {
    const sampling: SavedModelSamplingSettings = {
      enabled: true,
      params: { protocol: "anthropic", anthropic: { max_tokens: 1 } },
    };
    const params = thinkingLevelToModelThinkingParams(
      "low",
      "anthropic",
      "claude",
      sampling,
    );
    assert.equal(params?.protocol, "anthropic");
    if (params?.protocol !== "anthropic") throw new Error("unreachable");
    assert.equal(params.anthropic.budget_tokens, 1);
    // （原这里还有一条 `assert.ok(budget_tokens < 1 + 1)`，是上一条的子集且刻意
    //   写成 `1 + 1` 绕开字面量——cr1-ctests P2-4b 已清，纯冗余。）
  });

  it("T-AMT4 常量与 ANTHROPIC_SAMPLING_DEFAULTS 同源", () => {
    assert.equal(
      ANTHROPIC_BODY_DEFAULT_MAX_TOKENS,
      ANTHROPIC_SAMPLING_DEFAULTS.max_tokens,
    );
    assert.equal(ANTHROPIC_SAMPLING_DEFAULTS.max_tokens, 16_000);
  });
});