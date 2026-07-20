import assert from "node:assert/strict";
import test from "node:test";
import {
  markPreviewTabsDeletedUnderPathInList,
  syncPreviewTabsWithFileRows,
} from "@/features/workspace/preview-tab-sync";
import type { WorkplaceListRowDto } from "@shared/ipc-types";

const fileRow = (path: string): WorkplaceListRowDto => ({
  path,
  kind: "file",
  inclusionMode: "auto",
  displayState: "full",
});

test("syncPreviewTabsWithFileRows 将不在列表中的 tab 标为已删除", () => {
  const tabs = [
    {
      workspaceScope: "chat" as const,
      path: "/a.md",
      name: "a.md",
    },
    {
      workspaceScope: "chat" as const,
      path: "/b.md",
      name: "b.md",
    },
  ];
  const next = syncPreviewTabsWithFileRows(tabs, [fileRow("/a.md")], "chat");
  assert.equal(next[0]?.isDeleted, undefined);
  assert.equal(next[1]?.isDeleted, true);
});

test("syncPreviewTabsWithFileRows 文件重新出现时清除删除态", () => {
  const tabs = [
    {
      workspaceScope: "chat" as const,
      path: "/a.md",
      name: "a.md",
      isDeleted: true,
    },
  ];
  const next = syncPreviewTabsWithFileRows(tabs, [fileRow("/a.md")], "chat");
  assert.equal(next[0]?.isDeleted, false);
});

test("markPreviewTabsDeletedUnderPathInList 匹配子路径", () => {
  const tabs = [
    {
      workspaceScope: "chat" as const,
      path: "/notes/ch1.md",
      name: "ch1.md",
    },
    {
      workspaceScope: "chat" as const,
      path: "/other.md",
      name: "other.md",
    },
  ];
  const next = markPreviewTabsDeletedUnderPathInList(tabs, "chat", "/notes");
  assert.equal(next[0]?.isDeleted, true);
  assert.equal(next[1]?.isDeleted, undefined);
});
