import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionWorktreeSnapshotStore } from "@novel-master/core/worktree";

describe("SessionWorktreeSnapshotStore", () => {
  it("markDirty 后 getOrRefresh 返回非空 worktreeDisplay", async () => {
    const store = createSessionWorktreeSnapshotStore();
    const projectId = "p-dirty";
    const sessionId = "s-dirty";

    store.markDirty(projectId, sessionId);

    const snapshot = await store.getOrRefresh(projectId, sessionId, async () => ({
      worktreeDisplay: "worktree-body",
      listRows: [
        {
          kind: "file" as const,
          path: "/a.md",
          ruleState: "rule_on",
          inclusionMode: "auto",
          displayState: "full",
        },
      ],
    }));

    assert.ok(snapshot.worktreeDisplay.length > 0);
    assert.equal(snapshot.worktreeDisplay, "worktree-body");
    assert.equal(store.isDirty(projectId, sessionId), false);
  });

  it("markDirty 已有缓存时仍触发刷新", async () => {
    const store = createSessionWorktreeSnapshotStore();
    const projectId = "p-refresh";
    const sessionId = "s-refresh";

    await store.getOrRefresh(projectId, sessionId, async () => ({
      worktreeDisplay: "first",
      listRows: [],
    }));

    store.markDirty(projectId, sessionId);

    const refreshed = await store.getOrRefresh(projectId, sessionId, async () => ({
      worktreeDisplay: "second",
      listRows: [],
    }));

    assert.equal(refreshed.worktreeDisplay, "second");
  });
});
