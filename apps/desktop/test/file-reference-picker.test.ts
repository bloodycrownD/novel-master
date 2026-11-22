import assert from "node:assert/strict";
import test from "node:test";
import { composerAtPath } from "@/features/chat/FileReferencePicker";
import { listPickerChildRows } from "@/features/chat/FileReferencePicker";
import type { WorkplaceListRowDto } from "@shared/ipc-types";

const fixtureRows: WorkplaceListRowDto[] = [
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

test("listPickerChildRows：点目录进 cwd 后仅显示直子（含隐藏文件）", () => {
    const atRoot = listPickerChildRows(fixtureRows, "/");
    assert.deepEqual(
        atRoot.map((r) => r.path),
        ["/notes", "/a.md", "/hidden.md"],
    );

    // 相当于点目录进入 /notes 后的列表
    const inNotes = listPickerChildRows(fixtureRows, "/notes");
    assert.deepEqual(
        inNotes.map((r) => r.path),
        ["/notes/b.md", "/notes/c.md"],
    );
});

test("勾选目录确认产出 @path/ token", () => {
    const dirs = composerAtPath.tokensFromPickerSelection(["/notes"], []);
    if (!dirs.ok) throw dirs.error;
    assert.deepEqual(dirs.value, ["@/notes/"]);
    const root = composerAtPath.tokensFromPickerSelection(["/"], []);
    if (!root.ok) throw root.error;
    assert.deepEqual(root.value, ["@/"]);
});

test("文件多选确认产出多条 @path token", () => {
    const files = composerAtPath.tokensFromPickerSelection([], [
        "/a.md",
        "/notes/b.md",
    ]);
    if (!files.ok) throw files.error;
    assert.deepEqual(files.value, ["@/a.md", "@/notes/b.md"]);
});

test("多目录与多文件同确认不互斥", () => {
    const mixed = composerAtPath.tokensFromPickerSelection(
        ["/notes", "/"],
        ["/a.md", "/notes/b.md"],
    );
    if (!mixed.ok) throw mixed.error;
    assert.deepEqual(mixed.value, ["@/notes/", "@/", "@/a.md", "@/notes/b.md"]);
});
