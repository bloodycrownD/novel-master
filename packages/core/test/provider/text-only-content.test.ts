import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import {  TextOnlyContent  } from "../../src/infra/llm-protocol/logic/text-only-content.js";

describe("blocksToTextOnly", () => {
  it("returns UNSUPPORTED_CONTENT error for image blocks", () => {
    const result = TextOnlyContent.blocksToTextOnly([
      {
        type: "image",
        source: { kind: "url", url: "https://example.com/a.png" },
      },
    ]);
    assert.ok(!result.ok);
    assert.ok(AppErrorOps.is(result.error, "PROVIDER_UNSUPPORTED_CONTENT"));
    assert.match(result.error.message, /image/);
  });
});
