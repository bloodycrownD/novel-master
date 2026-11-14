import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readUserVfsSaveBaseline } from "../../src/domain/vfs/logic/read-user-vfs-save-baseline.js";
import { isVfsError } from "../../src/errors/vfs-errors.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";

// mock 用 legacy 手搓旧形态（name + 字符串短码）：readUserVfsSaveBaseline 的 isVfsError
// 判别（Step 9 改 isAppError）在中间态只认这个形态；届时同波把 mock 换 new AppError。
function legacyVfsError(code: string, message: string, path: string): Error {
  return Object.assign(new Error(message), {name: "VfsError", code, path});
}

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
        throw legacyVfsError("NOT_FOUND", "Path not found: /x", "/x");
      },
    });
    assert.equal(await readUserVfsSaveBaseline(vfs, "/x"), null);
  });

  it("T-BL-04: non-NOT_FOUND errors propagate", async () => {
    const vfs = mockVfs({
      read: async () => {
        throw legacyVfsError("CONFLICT", "conflict", "/x");
      },
    });
    await assert.rejects(
      () => readUserVfsSaveBaseline(vfs, "/x"),
      (e: unknown) => isVfsError(e) && (e as {code?: string}).code === "CONFLICT",
    );
  });
});
