import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  UserVfsSaveBaseline  } from "../../src/domain/vfs/logic/read-user-vfs-save-baseline.js";
import {  AppError, AppErrorOps  } from "../../src/errors/app-error.js";
import type { VfsReadResult, VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";
import {  Result  } from "../../src/errors/either.js";
import {  rejectsErr, unwrap  } from "../helpers/result-unwrap.js";

function mockVfs(handlers: {
  read?: (path: string) => Promise<Result<VfsReadResult, AppError>>;
}): VfsService {
  return {
    read: handlers.read ?? (async () => Result.ok({ path: "/x", content: "", version: 1, mtimeMs: 0 })),
  } as VfsService;
}

describe("UserVfsSaveBaseline.read", () => {
  it("T-BL-03: NOT_FOUND returns null", async () => {
    const vfs = mockVfs({
      read: async () => Result.err(new AppError("VFS_NOT_FOUND", {path: "/x", detail: "Path not found: /x"})),
    });
    assert.equal(unwrap(await UserVfsSaveBaseline.read(vfs, "/x")), null);
  });

  it("T-BL-04: non-NOT_FOUND errors propagate", async () => {
    const vfs = mockVfs({
      read: async () => Result.err(new AppError("VFS_INVALID_PATH", {path: "/x", detail: "conflict"})),
    });
    await rejectsErr(
      () => UserVfsSaveBaseline.read(vfs, "/x"),
      (e: unknown) => AppErrorOps.is(e, "VFS_INVALID_PATH"),
    );
  });
});
