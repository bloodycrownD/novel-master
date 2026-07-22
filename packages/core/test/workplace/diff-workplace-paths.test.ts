/**
 * T-RD1 / T-RD2：`diffWorkplacePaths` 任一 status key 命中即已加载。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWorkplacePaths } from "@/domain/workplace/logic/diff-workplace-paths.js";
import { fileCacheKey } from "@/domain/session-kkv/model/session-kkv-domains.js";

describe("diffWorkplacePaths (T-RD1 / T-RD2)", () => {
  it("T-RD1: live 有新 path、cache 无 → 返回该 path；全命中（含 attach 已写 key）→ []", () => {
    const live = [
      { path: "/new.md", status: "full" as const },
      { path: "/cached.md", status: "full" as const },
      { path: "/attach.md", status: "header" as const },
    ];
    const cacheKeys = new Set([
      fileCacheKey("full", "/cached.md"),
      // attach hydrate 写入的 filename: 也算已加载
      fileCacheKey("filename", "/attach.md"),
    ]);

    assert.deepEqual(diffWorkplacePaths(live, cacheKeys), ["/new.md"]);
    assert.deepEqual(
      diffWorkplacePaths(
        [
          { path: "/cached.md", status: "full" },
          { path: "/attach.md", status: "full" },
        ],
        cacheKeys,
      ),
      [],
    );
  });

  it("T-RD2: live 要求 full、cache 仅有 filename: → 不进入 needed", () => {
    const live = [{ path: "/a.md", status: "full" as const }];
    const cacheKeys = [fileCacheKey("filename", "/a.md")];

    assert.deepEqual(diffWorkplacePaths(live, cacheKeys), []);
  });

  it("header: 命中亦视为已加载", () => {
    const live = [
      { path: "/h.md", status: "full" as const },
      { path: "/need.md", status: "full" as const },
    ];
    const cacheKeys = new Set([fileCacheKey("header", "/h.md")]);

    assert.deepEqual(diffWorkplacePaths(live, cacheKeys), ["/need.md"]);
  });

  it("live path 去重，保持首次出现顺序", () => {
    const live = [
      { path: "/a.md", status: "full" as const },
      { path: "/b.md", status: "header" as const },
      { path: "/a.md", status: "filename" as const },
    ];
    assert.deepEqual(diffWorkplacePaths(live, []), ["/a.md", "/b.md"]);
  });
});
