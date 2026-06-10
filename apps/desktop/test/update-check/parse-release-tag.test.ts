import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReleaseTag } from "../../src/main/update-check/parse-release-tag.js";

describe("parseReleaseTag", () => {
  it("parses v1.2.3", () => {
    assert.equal(parseReleaseTag("v1.2.3"), "1.2.3");
  });

  it("parses without v prefix", () => {
    assert.equal(parseReleaseTag("1.0.0"), "1.0.0");
  });

  it("throws on invalid tag", () => {
    assert.throws(() => parseReleaseTag("latest"), /无法解析版本标签/);
  });
});
