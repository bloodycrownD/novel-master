import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactUrl } from "../../../src/infra/llm-protocol/logic/debug-fetch.js";

describe("debug-fetch redactUrl", () => {
  it("redacts key query param on valid URL", () => {
    const redacted = redactUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=SECRET123",
    );
    assert.ok(!redacted.includes("SECRET123"));
    assert.match(redacted, /key=\*\*\*/);
  });

  it("preserves non-key query params", () => {
    const redacted = redactUrl("https://api.example.com/v1?alt=sse&key=SECRET");
    assert.match(redacted, /alt=sse/);
    assert.match(redacted, /key=\*\*\*/);
  });

  it("falls back to regex when URL constructor fails", () => {
    const redacted = redactUrl("not-a-url?key=SECRET&foo=bar");
    assert.ok(!redacted.includes("SECRET"));
    assert.match(redacted, /key=\*\*\*/);
  });

  it("leaves URLs without key unchanged", () => {
    const url = "https://api.anthropic.com/v1/messages";
    assert.equal(redactUrl(url), url);
  });
});
