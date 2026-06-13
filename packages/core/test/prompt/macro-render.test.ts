import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocalDateTime } from "@novel-master/core";
import { PromptError } from "../../src/errors/prompt-errors.js";
import { renderMacro } from "../../src/infra/prompt-template/macro-render.js";

const fixedNow = new Date(2026, 4, 24, 15, 30, 45);

describe("renderMacro", () => {
  it("substitutes $filetree via root context", () => {
    const out = renderMacro("tree:\n{{ $filetree }}", {
      dot: {},
      root: { time: "t", week_cn: "w", filetree: "/\n└── a.md" },
    });
    assert.equal(out, "tree:\n/\n└── a.md");
  });

  it("substitutes $.time with fixed now", () => {
    const out = renderMacro("at {{ $.time }}", {
      dot: {},
      root: {
        time: formatLocalDateTime(fixedNow),
        week_cn: fixedNow.toLocaleDateString("zh-CN", { weekday: "long" }),
      },
    });
    assert.equal(out, "at 2026-05-24 15:30:45");
  });

  it("substitutes $.week_cn", () => {
    const week = fixedNow.toLocaleDateString("zh-CN", { weekday: "long" });
    const out = renderMacro("{{ $.week_cn }}", {
      dot: {},
      root: { time: "t", week_cn: week },
    });
    assert.equal(out, week);
    assert.match(week, /星期/);
  });

  it("removes comments", () => {
    const out = renderMacro("a{{/* hidden */}}b", {
      dot: {},
      root: { time: "t", week_cn: "w" },
    });
    assert.equal(out, "ab");
  });

  it("throws UNSUPPORTED_SYNTAX for if", () => {
    assert.throws(
      () =>
        renderMacro("{{ if .x }}", {
          dot: {},
          root: { time: "t", week_cn: "w" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "UNSUPPORTED_SYNTAX");
        return true;
      },
    );
  });

  it("throws UNKNOWN_FIELD for unknown root key", () => {
    assert.throws(
      () =>
        renderMacro("{{ $.foo }}", {
          dot: {},
          root: { time: "t", week_cn: "w" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "UNKNOWN_FIELD");
        return true;
      },
    );
  });

  it("throws UNKNOWN_FIELD for missing dot path when dot is empty", () => {
    assert.throws(
      () =>
        renderMacro("{{ .missing }}", {
          dot: {},
          root: { time: "t", week_cn: "w" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "UNKNOWN_FIELD");
        return true;
      },
    );
  });
});
