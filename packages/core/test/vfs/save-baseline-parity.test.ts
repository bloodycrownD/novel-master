import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapUserSaveToToolUses } from "../../src/domain/vfs/logic/user-vfs-save-mapping.js";
import { readUserVfsSaveBaseline } from "../../src/domain/vfs/logic/read-user-vfs-save-baseline.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";

describe("save baseline parity", () => {
  it("T-BL-01: disk baseline differs from stale memory baseline mapping", async () => {
    const diskB = "line1\nline2\nline3";
    const memoryA = "line1\nOLD\nline3";
    const contentC = "line1\nLINE2\nline3";

    const vfs = {
      read: async () => ({ content: diskB, version: 2 }),
    } as VfsService;

    const baseline = await readUserVfsSaveBaseline(vfs, "/note.md");
    const fromDisk = mapUserSaveToToolUses(baseline, contentC, "/note.md", contentC);
    const fromMemory = mapUserSaveToToolUses(memoryA, contentC, "/note.md", contentC);

    assert.notDeepEqual(fromDisk, fromMemory);
    assert.equal(fromDisk.kind, "edit");
  });

  it("T-BL-02: disk baseline small edit maps to edit", () => {
    const baseline = "line1\nline2\nline3";
    const content = "line1\nLINE2\nline3";
    const mapped = mapUserSaveToToolUses(baseline, content, "/a.txt", content);
    assert.equal(mapped.kind, "edit");
  });
});
