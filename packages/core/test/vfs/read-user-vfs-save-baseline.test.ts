import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readUserVfsSaveBaseline } from "../../src/domain/vfs/logic/read-user-vfs-save-baseline.js";
import { VfsError } from "../../src/errors/vfs-errors.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";

function mockVfs(handlers: {
  read?: (path: string) => Promise<{ content: string; version: number }>;
}): VfsService {
  return {
    read: handlers.read ?? (async () => ({ content: "", version: 1 })),
  } as VfsService;
}

describe("readUserVfsSaveBaseline", () => {
  it("T-BL-03: NOT_FOUND returns null", async () => {
    const vfs = mockVfs({
      read: async () => {
        throw new VfsError("NOT_FOUND", "Path not found: /x", { path: "/x" });
      },
    });
    assert.equal(await readUserVfsSaveBaseline(vfs, "/x"), null);
  });

  it("T-BL-04: non-NOT_FOUND errors propagate", async () => {
    const vfs = mockVfs({
      read: async () => {
        throw new VfsError("CONFLICT", "conflict", { path: "/x" });
      },
    });
    await assert.rejects(
      () => readUserVfsSaveBaseline(vfs, "/x"),
      (e: unknown) => e instanceof VfsError && e.code === "CONFLICT",
    );
  });
});
