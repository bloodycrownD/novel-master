import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  UserVfsSaveMapping  } from "../../src/domain/vfs/logic/user-vfs-save-mapping.js";
import {  UserVfsSaveBaseline  } from "../../src/domain/vfs/logic/read-user-vfs-save-baseline.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";
import {  Result  } from "../../src/errors/either.js";
import {  unwrap  } from "../helpers/result-unwrap.js";

describe("save baseline parity", () => {
  it("T-BL-01: disk baseline differs from stale memory baseline mapping", async () => {
    const diskB = "line1\nline2\nline3";
    const memoryA = "line1\nOLD\nline3";
    const contentC = "line1\nLINE2\nline3";

    const vfs = {
      read: async () => Result.ok({ path: "/note.md", content: diskB, version: 2, mtimeMs: 0 }),
    } as VfsService;

    const baseline = unwrap(await UserVfsSaveBaseline.read(vfs, "/note.md"));
    const fromDisk = UserVfsSaveMapping.mapToToolUses(baseline, contentC, "/note.md", contentC);
    const fromMemory = UserVfsSaveMapping.mapToToolUses(memoryA, contentC, "/note.md", contentC);

    assert.notDeepEqual(fromDisk, fromMemory);
    assert.equal(fromDisk.kind, "edit");
  });

  it("T-BL-02: disk baseline small edit maps to edit", () => {
    const baseline = "line1\nline2\nline3";
    const content = "line1\nLINE2\nline3";
    const mapped = UserVfsSaveMapping.mapToToolUses(baseline, content, "/a.txt", content);
    assert.equal(mapped.kind, "edit");
  });
});
