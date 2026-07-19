/**
 * T-CHIP1（Core）：formatStatusChipLabel / FromAttachment。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStatusChipLabel,
  formatStatusChipLabelFromAttachment,
} from "../../src/domain/chat/logic/status-chip-label.js";

describe("formatStatusChipLabel (T-CHIP1)", () => {
  it("已知枚举 → 中文二字:path", () => {
    assert.equal(formatStatusChipLabel("workplaceChange", "/a"), "规则:/a");
    assert.equal(formatStatusChipLabel("write", "/b"), "创建:/b");
    assert.equal(formatStatusChipLabel("annotate", "/c"), "批注:/c");
    assert.equal(formatStatusChipLabel("edit", "/e"), "编辑:/e");
    assert.equal(formatStatusChipLabel("delete", "/d"), "删除:/d");
    assert.equal(formatStatusChipLabel("mkdir", "/m"), "建目:/m");
    assert.equal(formatStatusChipLabel("rename", "/to"), "重命:/to");
    assert.equal(formatStatusChipLabel("userAttach", "/x"), "");
  });

  it("FromAttachment：有 action 走映射；rename 取 path(to)", () => {
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "workplaceChange",
        path: "/a",
        name: "/a",
        source: "workplace",
        content: null,
      }),
      "规则:/a",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "write",
        path: "/b",
        name: "/b",
        source: "user_ops",
        content: null,
      }),
      "创建:/b",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/c",
        name: "/c",
        source: "user_ops",
        content: null,
      }),
      "批注:/c",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "rename",
        path: "/new.md",
        name: "/new.md",
        source: "user_ops",
        content: '<action name="rename">\n{"from":"/old.md","to":"/new.md"}\n</action>',
      }),
      "重命:/new.md",
    );
  });

  it("无 action 降级：workplace→规则；旧 write:/；rename→取右侧；否则裸 path", () => {
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "workplace",
        name: "/w.md",
        path: "/w.md",
        content: null,
      }),
      "规则:/w.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "user_ops",
        name: "write:/old.md",
        path: "/old.md",
        content: null,
      }),
      "创建:/old.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "user_ops",
        name: "rename:/a.md→/b.md",
        content: null,
      }),
      "重命:/b.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "user_ops",
        name: "/bare.md",
        path: "/bare.md",
        content: null,
      }),
      "/bare.md",
    );
    // 不做「规则 ·」兼容
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "attach",
        name: "规则 · /x",
        content: null,
      }),
      "规则 · /x",
    );
  });
});
