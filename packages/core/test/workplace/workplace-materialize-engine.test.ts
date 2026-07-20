import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { evaluateWorkplaceRuleView } from "@/domain/workplace/logic/workplace-rule-engine.js";
import { materializeBlockFromView } from "@/domain/workplace/logic/workplace-materialize-engine.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";

function createSpyVfs(
  contents: ReadonlyMap<string, string>,
): VfsEntryRepository & { findByPathCalls: string[] } {
  const findByPathCalls: string[] = [];
  return {
    findByPathCalls,
    list: async () => [],
    findByPath: async (path: string) => {
      findByPathCalls.push(path);
      const content = contents.get(path);
      if (content == null) {
        return undefined;
      }
      return { path, content, version: 1, mtimeMs: 0 };
    },
    insert: async () => ({ version: 1 }),
    insertAtVersion: async () => ({ version: 1 }),
    insertDirectory: async () => undefined,
    update: async () => ({ version: 1 }),
    delete: async () => ({ deleted: true }),
    listAllPaths: async () => [],
    listDirectoryPathsUnderPrefix: async () => [],
    listEntriesUnderPrefix: async () => [],
    listFileMetaUnderPrefix: async () => [],
    scanContents: async () => [],
  };
}

describe("worktree materialize engine", () => {
  it("T-WEC16：仅 full/header 读正文，hidden/filename 不 findByPath", async () => {
    const scope = { kind: "project" as const, projectId: "p1" };
    const ctx = {
      dirRuleMap: new Map([
        [
          "/hdr",
          {
            scopeKey: "global",
            logicalPath: "/hdr",
            ruleEnabled: true,
            ...DEFAULT_WORKPLACE_DIR_RULE,
            headCount: 0,
            tailCount: 0,
            fillPolicy: "header" as const,
          },
        ],
        [
          "/hid",
          {
            scopeKey: "global",
            logicalPath: "/hid",
            ruleEnabled: true,
            ...DEFAULT_WORKPLACE_DIR_RULE,
            headCount: 0,
            tailCount: 0,
            fillPolicy: "hidden" as const,
          },
        ],
        [
          "/fn",
          {
            scopeKey: "global",
            logicalPath: "/fn",
            ruleEnabled: true,
            ...DEFAULT_WORKPLACE_DIR_RULE,
            headCount: 0,
            tailCount: 0,
            fillPolicy: "filename" as const,
          },
        ],
      ]),
      fileRuleMap: new Map([
        [
          "/show/a.md",
          {
            scopeKey: "global",
            logicalPath: "/show/a.md",
            inclusionMode: "show" as const,
          },
        ],
      ]),
      fileSet: new Set([
        "/show/a.md",
        "/hdr/b.md",
        "/hid/c.md",
        "/fn/d.md",
      ]),
      mtimeByPath: new Map([
        ["/show/a.md", 100],
        ["/hdr/b.md", 200],
        ["/hid/c.md", 300],
        ["/fn/d.md", 400],
      ]),
      allDirs: new Set(["/", "/show", "/hdr", "/hid", "/fn"]),
    };

    const view = evaluateWorkplaceRuleView(scope, ctx);
    assert.equal(view.displayByPath.get("/show/a.md"), "full");
    assert.equal(view.displayByPath.get("/hdr/b.md"), "header");
    assert.equal(view.displayByPath.get("/hid/c.md"), "hidden");
    assert.equal(view.displayByPath.get("/fn/d.md"), "filename");

    const vfs = createSpyVfs(
      new Map([
        ["/projects/p1/template/show/a.md", "FULL-A"],
        ["/projects/p1/template/hdr/b.md", "---\ntitle: B\n---\nbody"],
      ]),
    );

    const block = await materializeBlockFromView(
      view,
      vfs,
      scope,
      ctx.mtimeByPath,
    );

    assert.equal(vfs.findByPathCalls.length, 2);
    assert.ok(vfs.findByPathCalls.includes("/projects/p1/template/show/a.md"));
    assert.ok(vfs.findByPathCalls.includes("/projects/p1/template/hdr/b.md"));
    assert.match(block, /FULL-A/);
    assert.match(block, /title: B/);
    assert.match(block, /d\.md/);
    assert.doesNotMatch(block, /c\.md/);
  });
});
