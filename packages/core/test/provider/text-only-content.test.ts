import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../src/errors/app-error.js";
import { blocksToTextOnly } from "../../src/infra/llm-protocol/logic/text-only-content.js";

describe("blocksToTextOnly", () => {
  it("returns UNSUPPORTED_CONTENT error for image blocks", () => {
    const result = blocksToTextOnly([
      {
        type: "image",
        source: { kind: "url", url: "https://example.com/a.png" },
      },
    ]);
    assert.ok(!result.ok);
    assert.ok(isAppError(result.error, "PROVIDER_UNSUPPORTED_CONTENT"));
    assert.match(result.error.message, /image/);
  });
});
