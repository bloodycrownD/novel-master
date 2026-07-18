import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectNamedExports } from "./helpers/export-snapshot.js";

const SUBPATHS = [
  "agent",
  "chat",
  "compaction",
  "events",
  "feature-flags",
  "message-checkpoint",
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

  it("T-WEC18: worktree allowlist 无 markDirty 遗留 API", async () => {
    const snapshot = (
      await import("./snapshots/public-worktree-allowlist.json", {
        with: { type: "json" },
      })
    ).default as string[];
    const forbidden = [
      "createSessionWorktreeSnapshotStore",
      "markDirty",
      "getOrRefresh",
      "invalidateSessionWorktreeSnapshot",
    ];
    for (const name of forbidden) {
      assert.equal(
        snapshot.includes(name),
        false,
        `public/worktree 不应导出 ${name}`,
      );
    }
    assert.ok(snapshot.includes("assembleWorkplaceDisplay"));
    assert.equal(
      snapshot.includes("createSessionWorktreeBlockStore"),
      false,
      "public/worktree 不应再导出 createSessionWorktreeBlockStore",
    );
    assert.equal(
      snapshot.includes("captureSessionWorktreeBlock"),
      false,
      "public/worktree 不应再导出 captureSessionWorktreeBlock",
    );
    assert.equal(
      snapshot.includes("getCapturedBlockOrCapture"),
      false,
      "public/worktree 不应再导出 getCapturedBlockOrCapture",
    );
  });
});
