import assert from "node:assert/strict";
import {  describe, it, mock  } from "node:test";
import {  Result  } from "../../src/errors/either.js";
import {  DynamicMacrosExpansion  } from "@/domain/prompt/logic/expand-dynamic-macros.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

describe("DynamicMacrosExpansion.expand", () => {
  it("T-WEC14：$filetree 展开只走实时 worktree.renderFileTree", async () => {
    // port 已改返回 Result<string, AppError>，mock 同形（裸字符串会落进 Err 分支）
    const renderFileTree = mock.fn(async () => Result.ok("/\n└── note.md 全部加载"));
    const worktree = { renderFileTree } as unknown as WorkplaceService;

    const out = await DynamicMacrosExpansion.expand("树: {{$filetree}}", { workplace: worktree });

    assert.equal(renderFileTree.mock.callCount(), 1);
    assert.equal(out.ok, true);
    assert.match(out.ok ? out.value : "", /note\.md 全部加载/);
  });

  it("T-SNAP1：ctx.filetree 快照优先，不调实时 renderFileTree", async () => {
    const renderFileTree = mock.fn(async () => "/live-tree");
    const worktree = { renderFileTree } as unknown as WorkplaceService;

    const out = await DynamicMacrosExpansion.expand("树: {{$filetree}}", {
      workplace: worktree,
      filetree: "/snapshot-tree",
    });

    assert.equal(renderFileTree.mock.callCount(), 0);
    assert.equal(out.ok, true);
    assert.match(out.ok ? out.value : "", /\/snapshot-tree/);
  });

  it("非法宏返回 PROMPT_INVALID_MACRO，不漏出 infra 的 AppError", async () => {
    const out = await DynamicMacrosExpansion.expand("坏: {{.missing}}", {});

    assert.equal(out.ok, false);
    assert.equal(out.ok ? "" : out.error.key, "PROMPT_INVALID_MACRO");
  });
});
