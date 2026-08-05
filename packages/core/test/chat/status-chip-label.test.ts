/**
 * T-CHIP1 / T-CR1（Core）：formatStatusChipLabel / FromAttachment。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStatusChipLabel,
  formatStatusChipLabelFromAttachment,
} from "../../src/domain/chat/logic/status-chip-label.js";

describe("formatStatusChipLabel (T-CHIP1 / T-CR1)", () => {
  it("已知枚举 → 中文二字:path；mkdir 与 write 同为「创建」；rename/move 自描述", () => {
    assert.equal(formatStatusChipLabel("workplaceChange", "/a"), "规则:/a");
    assert.equal(formatStatusChipLabel("write", "/b"), "创建:/b");
    assert.equal(formatStatusChipLabel("annotate", "/c"), "批注:/c");
    assert.equal(formatStatusChipLabel("edit", "/e"), "编辑:/e");
    assert.equal(formatStatusChipLabel("delete", "/d"), "删除:/d");
    assert.equal(formatStatusChipLabel("mkdir", "/m"), "创建:/m");
    assert.equal(formatStatusChipLabel("rename", "/to"), "改名:/to");
    assert.equal(formatStatusChipLabel("move", "/dir/to"), "移动:/dir/to");
    assert.equal(formatStatusChipLabel("userAttach", "/x"), "");
  });

  it("FromAttachment：有 action 走映射；rename→改名；move→移动", () => {
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
        action: "mkdir",
        path: "/m",
        name: "/m",
        source: "user_ops",
        content: null,
      }),
      "创建:/m",
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
      "改名:/new.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "move",
        path: "/续写/文风指导.md",
        name: "/续写/文风指导.md",
        source: "user_ops",
        content:
          '<action name="move">\n{"from":"/文风指导.md","to":"/续写/文风指导.md"}\n</action>',
      }),
      "移动:/续写/文风指导.md",
    );
  });

  it("annotate chip：有 content 时显示原文片段而非路径；截断+省略号；content 为 null 回落路径", () => {
    // content 含 originalText → chip 显示截断原文
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/note.md",
        name: "/note.md",
        source: "user_ops",
        content:
          '<action name="annotate">\n{"path":"/note.md","originalText":"短原文","userAnnotation":"说明"}\n</action>',
      }),
      "批注:短原文",
    );
    // 超长原文 → 截断 20 字 + 省略号
    const long = "这是一段很长的划词原文内容超过二十个字符就会被截断掉哦";
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/note.md",
        name: "/note.md",
        source: "user_ops",
        content:
          '<action name="annotate">\n{"originalText":"' +
          long +
          '"}\n</action>',
      }),
      "批注:" + long.slice(0, 20) + "…",
    );
    // 多行原文 → 换行压空格
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/note.md",
        name: "/note.md",
        source: "user_ops",
        content:
          '<action name="annotate">\n{"originalText":"第一行\\n第二行"}\n</action>',
      }),
      "批注:第一行 第二行",
    );
    // content 为 null → 回落路径（向后兼容）
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
    // content JSON 缺 originalText → 回落路径
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/c",
        name: "/c",
        source: "user_ops",
        content:
          '<action name="annotate">\n{"path":"/c","userAnnotation":"只有说明"}\n</action>',
      }),
      "批注:/c",
    );
    // content JSON 解析失败 → 回落路径
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "annotate",
        path: "/c",
        name: "/c",
        source: "user_ops",
        content: '<action name="annotate">\n{not json}\n</action>',
      }),
      "批注:/c",
    );
  });

  it("无 action 降级：workplace→规则；旧 write:/、mkdir:/；rename→取右侧并按父目录区分；否则裸 path", () => {
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
        name: "mkdir:/dir",
        path: "/dir",
        content: null,
      }),
      "创建:/dir",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "user_ops",
        name: "rename:/a.md→/b.md",
        content: null,
      }),
      "改名:/b.md",
    );
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "user_ops",
        name: "rename:/a.md→/dir/b.md",
        content: null,
      }),
      "移动:/dir/b.md",
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
