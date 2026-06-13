import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderSessionVfsTree } from "../../src/domain/vfs/logic/render-session-vfs-tree.js";
import type { VfsListEntry, VfsService } from "@novel-master/core";

function mockVfs(entries: readonly VfsListEntry[]): VfsService {
  return {
    async list() {
      return [...entries];
    },
  } as unknown as VfsService;
}

describe("renderSessionVfsTree", () => {
  it("目录优先、同层字典序", async () => {
    const tree = await renderSessionVfsTree(
      mockVfs([
        { path: "/b.txt", kind: "file" },
        { path: "/a-dir", kind: "directory" },
        { path: "/a-dir/z.txt", kind: "file" },
        { path: "/a-dir/m.txt", kind: "file" },
      ]),
    );
    assert.match(tree, /^\/\n/);
    const lines = tree.split("\n");
    const aDirIdx = lines.findIndex((l) => l.includes("a-dir/"));
    const bTxtIdx = lines.findIndex((l) => l.includes("b.txt"));
    assert.ok(aDirIdx >= 0 && bTxtIdx >= 0);
    assert.ok(aDirIdx < bTxtIdx, "目录应排在文件前");
    const mIdx = lines.findIndex((l) => l.includes("m.txt"));
    const zIdx = lines.findIndex((l) => l.includes("z.txt"));
    assert.ok(mIdx >= 0 && zIdx >= 0);
    assert.ok(mIdx < zIdx, "同层文件应字典序");
  });
});
