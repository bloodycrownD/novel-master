import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpdateCheck } from "@novel-master/core/common";

describe("parseReleaseTag", () => {
  it("parses v1.2.3", () => {
    assert.equal(UpdateCheck.parseTag("v1.2.3"), "1.2.3");
  });

  it("parses without v prefix", () => {
    assert.equal(UpdateCheck.parseTag("1.0.0"), "1.0.0");
  });

  it("throws on invalid tag", () => {
    assert.throws(() => UpdateCheck.parseTag("latest"), /无法解析版本标签/);
  });
});
