/**
 * action-xml-to-tool-uses 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionXmlToToolUses } from "../../src/domain/vfs/logic/action-xml-to-tool-uses.js";

describe("actionXmlToToolUses", () => {
  it("解析 delete", () => {
    const uses = actionXmlToToolUses('<user-vfs-action kind="delete" path="draft.md" />');
    assert.equal(uses.length, 1);
    assert.equal(uses[0]?.name, "fs");
    assert.equal(uses[0]?.input.command, "rm draft.md");
  });

  it("解析 mkdir", () => {
    const uses = actionXmlToToolUses('<user-vfs-action kind="mkdir" path="notes/" />');
    assert.equal(uses[0]?.name, "fs");
    assert.equal(uses[0]?.input.command, "mkdir notes/");
  });

  it("解析 rename", () => {
    const uses = actionXmlToToolUses(
      '<user-vfs-action kind="rename" from="a.md" to="b.md" />',
    );
    assert.equal(uses[0]?.name, "fs");
    assert.equal(uses[0]?.input.command, "mv a.md b.md");
  });

  it("解析 save-edit", () => {
    const xml =
      '<user-vfs-action kind="save" path="ch.md" method="edit" hunks="1">' +
      '<edit-hunk index="1"><old>old</old><new>new</new></edit-hunk></user-vfs-action>';
    const uses = actionXmlToToolUses(xml);
    assert.equal(uses.length, 1);
    assert.equal(uses[0]?.name, "edit");
    assert.equal(uses[0]?.input.path, "ch.md");
    assert.equal(uses[0]?.input.oldString, "old");
    assert.equal(uses[0]?.input.newString, "new");
  });

  it("解析 save-write", () => {
    const uses = actionXmlToToolUses(
      '<user-vfs-action kind="save" path="ch.md" method="write" reason="anchor-not-unique" />',
    );
    assert.equal(uses[0]?.name, "write");
    assert.equal(uses[0]?.input.path, "ch.md");
  });
});
