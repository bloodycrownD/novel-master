import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { expandDynamicMacros } from "@/domain/prompt/logic/expand-dynamic-macros.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

describe("expandDynamicMacros", () => {
  it("T-WEC14：$filetree 展开只走实时 worktree.renderFileTree", async () => {
    const renderFileTree = mock.fn(async () => "/\n└── note.md 全部加载");
    const worktree = { renderFileTree } as unknown as WorkplaceService;

    const out = await expandDynamicMacros("树: {{$filetree}}", { workplace: worktree });

    assert.equal(renderFileTree.mock.callCount(), 1);
    assert.match(out, /note\.md 全部加载/);
  });
});
