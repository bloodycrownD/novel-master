import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@novel-master/core";
import snapshot from "./snapshots/main-entry-allowlist.json" with { type: "json" };
import { collectNamedExports } from "./helpers/export-snapshot.js";

describe("主入口 export allowlist 快照", () => {
  it("runtime named exports 与快照一致", () => {
    const actual = collectNamedExports(core as Record<string, unknown>);
    assert.deepEqual(actual, [...snapshot].sort());
  });
});
