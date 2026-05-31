import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { blocksToTextOnly } from "../../src/infra/llm-protocol/logic/text-only-content.js";

describe("blocksToTextOnly", () => {
  it("throws UNSUPPORTED_CONTENT for image blocks", () => {
    assert.throws(
      () =>
        blocksToTextOnly([
          {
            type: "image",
            source: { kind: "url", url: "https://example.com/a.png" },
          },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "UNSUPPORTED_CONTENT");
        assert.match(err.message, /image/);
        return true;
      },
    );
  });
});
