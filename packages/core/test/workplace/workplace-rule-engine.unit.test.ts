import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateWorkplaceRuleView } from "@/domain/workplace/logic/workplace-rule-engine.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";

describe("worktree rule engine (unit)", () => {
  it("T-WEC15：纯函数 rows 仅含 enum 且 displayByPath 与 file 行一致", () => {
    const ctx = {
      dirRuleMap: new Map([
        [
          "/batch",
          {
            scopeKey: "global",
            logicalPath: "/batch",
            ruleEnabled: true,
            ...DEFAULT_WORKPLACE_DIR_RULE,
            headCount: 0,
            tailCount: 0,
            fillPolicy: "hidden" as const,
          },
        ],
      ]),
      fileRuleMap: new Map([
        [
          "/batch/show-a.md",
          {
            scopeKey: "global",
            logicalPath: "/batch/show-a.md",
            inclusionMode: "show" as const,
          },
        ],
        [
          "/batch/show-b.md",
          {
            scopeKey: "global",
            logicalPath: "/batch/show-b.md",
            inclusionMode: "show" as const,
          },
        ],
      ]),
      fileSet: new Set([
        "/batch/f0.md",
        "/batch/show-a.md",
        "/batch/show-b.md",
      ]),
      mtimeByPath: new Map([
        ["/batch/f0.md", 100],
        ["/batch/show-a.md", 200],
        ["/batch/show-b.md", 300],
      ]),
      allDirs: new Set(["/", "/batch"]),
    };

    const view = evaluateWorkplaceRuleView({ kind: "global" }, ctx);

    for (const row of view.rows) {
      if (row.kind === "dir") {
        assert.ok(row.ruleState === "rule_on" || row.ruleState === "rule_off");
        assert.ok(!("inclusionMode" in row));
        assert.ok(!("displayState" in row));
      } else {
        assert.ok(
          row.inclusionMode === "auto" ||
            row.inclusionMode === "show" ||
            row.inclusionMode === "hide",
        );
        assert.equal(row.displayState, view.displayByPath.get(row.path));
        assert.ok(!("ruleState" in row));
      }
    }

    assert.equal(view.displayByPath.size, ctx.fileSet.size);
    const showA = view.rows.find(
      (r) => r.kind === "file" && r.path === "/batch/show-a.md",
    );
    assert.ok(showA && showA.kind === "file");
    assert.equal(showA.inclusionMode, "show");
    assert.equal(showA.displayState, "full");
  });
});
