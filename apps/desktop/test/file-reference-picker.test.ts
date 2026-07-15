import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentsFromPickerSelection,
  listPickerChildRows,
} from "@/features/chat/FileReferencePicker";
import type { WorktreeListRowDto } from "@shared/ipc-types";

const fixtureRows: WorktreeListRowDto[] = [
  { kind: "dir", path: "/", ruleState: "rule_on" },
  { kind: "dir", path: "/notes", ruleState: "rule_on" },
  {
    kind: "file",
    path: "/a.md",
    inclusionMode: "show",
    displayState: "full",
  },
  {
    kind: "file",
    path: "/notes/b.md",
    inclusionMode: "show",
    displayState: "full",
  },
  {
    kind: "file",
    path: "/notes/c.md",
    inclusionMode: "show",
    displayState: "full",
  },
  {
    kind: "file",
    path: "/hidden.md",
    inclusionMode: "hide",
    displayState: "hidden",
  },
];

test("listPickerChildRows：点目录进 cwd 后仅显示直子", () => {
  const atRoot = listPickerChildRows(fixtureRows, "/");
  assert.deepEqual(
    atRoot.map((r) => r.path),
    ["/notes", "/a.md"],
  );

  // 相当于点目录进入 /notes 后的列表
  const inNotes = listPickerChildRows(fixtureRows, "/notes");
  assert.deepEqual(
    inNotes.map((r) => r.path),
    ["/notes/b.md", "/notes/c.md"],
  );
});

test("勾选目录确认产出 dir attachment", () => {
  assert.deepEqual(attachmentsFromPickerSelection("/notes", []), [
    {
      name: "notes",
      source: "attach",
      type: "dir",
      content: null,
      path: "/notes",
    },
  ]);
  // 根目录 / 允许选择
  assert.deepEqual(attachmentsFromPickerSelection("/", []), [
    {
      name: "/",
      source: "attach",
      type: "dir",
      content: null,
      path: "/",
    },
  ]);
});

test("文件多选确认产出多条 text attachment", () => {
  assert.deepEqual(
    attachmentsFromPickerSelection(null, ["/a.md", "/notes/b.md"]),
    [
      {
        name: "a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/a.md",
      },
      {
        name: "b.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/notes/b.md",
      },
    ],
  );
});
