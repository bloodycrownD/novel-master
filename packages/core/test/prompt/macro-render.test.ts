import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocalDateTime } from "@novel-master/core";
import { PromptError } from "../../src/errors/prompt-errors.js";
import { renderMacro } from "../../src/infra/prompt-template/macro-render.js";

const fixedNow = new Date(2026, 4, 24, 15, 30, 45);

describe("renderMacro", () => {
  it("substitutes .worktree", () => {
    const out = renderMacro("wt={{ .worktree }}", {
      dot: { worktree: "DISPLAY" },
      root: { time: "t", week_cn: "w" },
    });
    assert.equal(out, "wt=DISPLAY");
  });

  it("substitutes $.time with fixed now", () => {
    const out = renderMacro("at {{ $.time }}", {
      dot: { worktree: "" },
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
      dot: { worktree: "" },
      root: { time: "t", week_cn: week },
    });
    assert.equal(out, week);
    assert.match(week, /星期/);
  });

  it("removes comments", () => {
    const out = renderMacro("a{{/* hidden */}}b", {
      dot: { worktree: "" },
      root: { time: "t", week_cn: "w" },
    });
    assert.equal(out, "ab");
  });

  it("throws UNKNOWN_FIELD for missing dot path", () => {
    assert.throws(
      () =>
        renderMacro("{{ .missing }}", {
          dot: { worktree: "x" },
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
