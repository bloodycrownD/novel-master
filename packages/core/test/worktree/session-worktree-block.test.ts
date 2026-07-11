import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import {
  captureSessionWorktreeBlock,
  createSessionWorktreeBlockStore,
  getCapturedBlockOrCapture,
  SessionWorktreeBlockScopeError,
} from "@novel-master/core/worktree";

describe("SessionWorktreeBlockStore", () => {
  it("T-WEC11: 无条目时 getCapturedBlock 返回 undefined", () => {
    const store = createSessionWorktreeBlockStore();
    assert.equal(store.getCapturedBlock("p1", "s1"), undefined);
  });

  it("T-WEC11: capture 后 getCapturedBlock 返回同文本", () => {
    const store = createSessionWorktreeBlockStore();
    const projectId = "p-capture";
    const sessionId = "s-capture";

    store.capture(projectId, sessionId, { worktreeDisplay: "worktree-body" });
    const block = store.getCapturedBlock(projectId, sessionId);

    assert.notEqual(block, undefined);
    assert.equal(block!.worktreeDisplay, "worktree-body");
    assert.equal(typeof block!.capturedAtMs, "number");
    assert.ok(block!.capturedAtMs > 0);
  });

  it("T-WEC11: capture 空串仍写入空块", () => {
    const store = createSessionWorktreeBlockStore();
    const projectId = "p-empty";
    const sessionId = "s-empty";

    store.capture(projectId, sessionId, { worktreeDisplay: "" });
    const block = store.getCapturedBlock(projectId, sessionId);

    assert.notEqual(block, undefined);
    assert.equal(block!.worktreeDisplay, "");
  });

  it("T-WEC11: 再次 capture 覆盖旧条目", () => {
    const store = createSessionWorktreeBlockStore();
    const projectId = "p-overwrite";
    const sessionId = "s-overwrite";

    store.capture(projectId, sessionId, { worktreeDisplay: "first" });
    store.capture(projectId, sessionId, { worktreeDisplay: "second" });

    const block = store.getCapturedBlock(projectId, sessionId);
    assert.equal(block!.worktreeDisplay, "second");
  });

  it("clear 后 getCapturedBlock 返回 undefined", () => {
    const store = createSessionWorktreeBlockStore();
    const projectId = "p-clear";
    const sessionId = "s-clear";

    store.capture(projectId, sessionId, { worktreeDisplay: "body" });
    store.clear(projectId, sessionId);

    assert.equal(store.getCapturedBlock(projectId, sessionId), undefined);
  });
});

describe("getCapturedBlockOrCapture", () => {
  it("T-WEC11: 无条目时显式 capture 并返回块", async () => {
    const store = createSessionWorktreeBlockStore();
    const scope = {
      kind: "session" as const,
      projectId: "p-miss",
      sessionId: "s-miss",
    };
    let materialized = false;
    const wt = {
      materializePersistBlock: async () => {
        materialized = true;
        return { worktreeDisplay: "from-capture" };
      },
    } as Pick<WorktreeService, "materializePersistBlock"> as WorktreeService;

    const block = await getCapturedBlockOrCapture(scope, {
      worktree: () => wt,
      worktreeBlockStore: store,
    });

    assert.equal(materialized, true);
    assert.equal(block.worktreeDisplay, "from-capture");
    assert.equal(
      store.getCapturedBlock("p-miss", "s-miss")?.worktreeDisplay,
      "from-capture",
    );
  });

  it("T-WEC11: 有条目时不重复 capture", async () => {
    const store = createSessionWorktreeBlockStore();
    store.capture("p-hit", "s-hit", { worktreeDisplay: "cached" });
    const scope = {
      kind: "session" as const,
      projectId: "p-hit",
      sessionId: "s-hit",
    };
    const wt = {
      materializePersistBlock: async () => {
        throw new Error("不应物化");
      },
    } as Pick<WorktreeService, "materializePersistBlock"> as WorktreeService;

    const block = await getCapturedBlockOrCapture(scope, {
      worktree: () => wt,
      worktreeBlockStore: store,
    });

    assert.equal(block.worktreeDisplay, "cached");
  });

  it("T-WEC11: capture 空串后 getCapturedBlockOrCapture 返回空块", async () => {
    const store = createSessionWorktreeBlockStore();
    const scope = {
      kind: "session" as const,
      projectId: "p-empty-read",
      sessionId: "s-empty-read",
    };
    const wt = {
      materializePersistBlock: async () => ({ worktreeDisplay: "" }),
    } as Pick<WorktreeService, "materializePersistBlock"> as WorktreeService;

    const block = await getCapturedBlockOrCapture(scope, {
      worktree: () => wt,
      worktreeBlockStore: store,
    });

    assert.equal(block.worktreeDisplay, "");
    assert.notEqual(store.getCapturedBlock("p-empty-read", "s-empty-read"), undefined);
  });
});

describe("captureSessionWorktreeBlock", () => {
  it("session scope 物化并写入 block store", async () => {
    const store = createSessionWorktreeBlockStore();
    const scope = {
      kind: "session" as const,
      projectId: "p1",
      sessionId: "s1",
    };
    const wt = {
      materializePersistBlock: async () => ({ worktreeDisplay: "mock-body" }),
    } as Pick<WorktreeService, "materializePersistBlock"> as WorktreeService;

    const block = await captureSessionWorktreeBlock(scope, {
      worktree: () => wt,
      worktreeBlockStore: store,
    });

    assert.equal(block.worktreeDisplay, "mock-body");
    assert.equal(
      store.getCapturedBlock("p1", "s1")?.worktreeDisplay,
      "mock-body",
    );
  });

  it("非 session scope 抛出 SessionWorktreeBlockScopeError", async () => {
    const store = createSessionWorktreeBlockStore();

    await assert.rejects(
      () =>
        captureSessionWorktreeBlock(
          { kind: "global" },
          {
            worktree: () => {
              throw new Error("不应调用 worktree");
            },
            worktreeBlockStore: store,
          },
        ),
      SessionWorktreeBlockScopeError,
    );
  });
});
