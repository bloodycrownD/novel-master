import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../src/errors/app-error.js";
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
        assert.ok(isAppError(err, "PROVIDER_UNSUPPORTED_CONTENT"));
        assert.match(err.message, /image/);
        return true;
      },
    );
  });
});
