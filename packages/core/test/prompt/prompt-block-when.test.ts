import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePromptBlockWhen } from "@novel-master/core";

describe("evaluatePromptBlockWhen", () => {
  it("present: abstract is true only for non-empty trimmed string", () => {
    assert.equal(
      evaluatePromptBlockWhen({ present: "abstract" }, { abstract: "x" }),
      true,
    );
    assert.equal(
      evaluatePromptBlockWhen({ present: "abstract" }, { abstract: "  " }),
      false,
    );
    assert.equal(
      evaluatePromptBlockWhen({ present: "abstract" }, { abstract: "" }),
      false,
    );
    assert.equal(
      evaluatePromptBlockWhen({ present: "abstract" }, {}),
      false,
    );
  });

  it("absent: abstract is inverse of present", () => {
    assert.equal(
      evaluatePromptBlockWhen({ absent: "abstract" }, { abstract: "" }),
      true,
    );
    assert.equal(
      evaluatePromptBlockWhen({ absent: "abstract" }, { abstract: "hi" }),
      false,
    );
  });
});
