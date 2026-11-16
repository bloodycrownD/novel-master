import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocalDateTime } from "@novel-master/core/provider";
import { isAppError } from "../../src/errors/app-error.js";
import { renderMacro } from "../../src/infra/prompt-template/macro-render.js";
import { unwrap } from "../helpers/result-unwrap.js";

const fixedNow = new Date(2026, 4, 24, 15, 30, 45);

describe("renderMacro", () => {
  it("substitutes $filetree via root context", () => {
    const out = unwrap(renderMacro("tree:\n{{ $filetree }}", {
      dot: {},
      root: { time: "t", week_cn: "w", filetree: "/\n└── a.md" },
    }));
    assert.equal(out, "tree:\n/\n└── a.md");
  });

  it("substitutes $.time with fixed now", () => {
    const out = unwrap(renderMacro("at {{ $.time }}", {
      dot: {},
      root: {
        time: formatLocalDateTime(fixedNow),
        week_cn: fixedNow.toLocaleDateString("zh-CN", { weekday: "long" }),
      },
    }));
    assert.equal(out, "at 2026-05-24 15:30:45");
  });

  it("substitutes $.week_cn", () => {
    const week = fixedNow.toLocaleDateString("zh-CN", { weekday: "long" });
    const out = unwrap(renderMacro("{{ $.week_cn }}", {
      dot: {},
      root: { time: "t", week_cn: week },
    }));
    assert.equal(out, week);
    assert.match(week, /星期/);
  });

  it("removes comments", () => {
    const out = unwrap(renderMacro("a{{/* hidden */}}b", {
      dot: {},
      root: { time: "t", week_cn: "w" },
    }));
    assert.equal(out, "ab");
  });

  it("throws UNSUPPORTED_SYNTAX for if", () => {
    // 四期签名：renderMacro 失败沿 Result.err 回传，不再 throw。
    const r = renderMacro("{{ if .x }}", {
      dot: {},
      root: { time: "t", week_cn: "w" },
    });
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(isAppError(r.error, "PROMPT_UNSUPPORTED_SYNTAX"));
  });

  it("throws UNKNOWN_FIELD for unknown root key", () => {
    const r = renderMacro("{{ $.foo }}", {
      dot: {},
      root: { time: "t", week_cn: "w" },
    });
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(isAppError(r.error, "PROMPT_UNKNOWN_FIELD"));
  });

  it("throws UNKNOWN_FIELD for missing dot path when dot is empty", () => {
    const r = renderMacro("{{ .missing }}", {
      dot: {},
      root: { time: "t", week_cn: "w" },
    });
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(isAppError(r.error, "PROMPT_UNKNOWN_FIELD"));
  });
});
