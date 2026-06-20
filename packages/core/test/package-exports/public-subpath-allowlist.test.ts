import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectNamedExports } from "./helpers/export-snapshot.js";

const SUBPATHS = [
  "agent",
  "chat",
  "compaction",
  "events",
  "feature-flags",
  "prompt",
  "provider",
  "regex",
  "session-fs",
  "vfs",
  "worktree",
] as const;

describe("public 子入口 export allowlist 快照", () => {
  for (const name of SUBPATHS) {
    it(`@novel-master/core/${name} 与快照一致`, async () => {
      const snapshot = (
        await import(`./snapshots/public-${name}-allowlist.json`, {
          with: { type: "json" },
        })
      ).default as string[];
      const mod = await import(`@novel-master/core/${name}`);
      const actual = collectNamedExports(mod as Record<string, unknown>);
      assert.deepEqual(actual, [...snapshot].sort());
    });
  }
});
