/**
 * T-SK11（扫描侧）：手输 `$技能名` 扫描 / 前导边界 / 字符集 / 去重 /
 * 不存在技能名容错（扫描不查存在性，未知名照常落库、不阻塞发送）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentScanner } from "../../src/domain/chat/logic/attachment/attachment-scanner.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

describe("scanSkillAttachments (T-SK11)", () => {
  it("正文含 `$技能名` → skillAttach 附件（无 path，skillName/name 同值，token 保留）", () => {
    const text = "用 $demo-skill 帮我改";
    const scanned = attachmentScanner.scanSkills(text);
    assert.equal(scanned.length, 1);
    const att = scanned[0]!;
    assert.equal(att.action, "skillAttach");
    assert.equal(att.source, "attach");
    assert.equal(att.type, "text");
    assert.equal(att.content, null);
    assert.equal(att.path, undefined);
    assert.equal(att.skillName, "demo-skill");
    assert.equal(att.name, "demo-skill");
    // 正文 token 原样保留（扫描不剥离）
    assert.ok(text.includes("$demo-skill"));
  });

  it("前导边界：行首/空格/tab 后可触发；a$b、$$b 不误吞", () => {
    assert.equal(attachmentScanner.scanSkills("$foo").length, 1);
    assert.equal(attachmentScanner.scanSkills("用 $foo").length, 1);
    assert.equal(attachmentScanner.scanSkills("用\t$foo").length, 1);
    assert.equal(attachmentScanner.scanSkills("用\n$foo").length, 1);
    // `$` 前是非空白字符 → 正文片段，不扫描
    assert.equal(attachmentScanner.scanSkills("a$b").length, 0);
    assert.equal(attachmentScanner.scanSkills("$$b").length, 0);
    assert.equal(attachmentScanner.scanSkills("价格$100").length, 0);
  });

  it("字符集：`$` 后遇空白/$/@ 停扫；$/x、$@x 不落库；$foo/bar 取 foo", () => {
    assert.deepEqual(attachmentScanner.scanSkills("$foo bar").map((a) => a.skillName), [
      "foo",
    ]);
    assert.equal(attachmentScanner.scanSkills("$/foo").length, 0);
    assert.equal(attachmentScanner.scanSkills("$@foo").length, 0);
    // `/` 停扫（避免与 @path token 相互吞噬）
    assert.deepEqual(attachmentScanner.scanSkills("$foo/bar").map((a) => a.skillName), [
      "foo",
    ]);
    // 非法技能名形态（首字符 `.`）视作正文跳过
    assert.equal(attachmentScanner.scanSkills("$..x").length, 0);
    assert.equal(attachmentScanner.scanSkills("$.hidden").length, 0);
  });

  it("同名去重；skillSeenKey 与去重键同形", () => {
    const scanned = attachmentScanner.scanSkills("先 $foo 再 $foo 最后 $foo");
    assert.equal(scanned.length, 1);
    assert.equal(attachmentScanner.skillKey("foo"), "skill:foo");
  });

  it("不存在技能名容错：扫描不查存在性，未知名照常落库", () => {
    const scanned = attachmentScanner.scanSkills("调 $no-such-skill 试试");
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0]!.skillName, "no-such-skill");
  });

  it("合并去重：已有 skillAttach chip 与正文同名 → 仅一条；与 @path 附件共存", () => {
    const text = "见 @/a.md 与 $demo";
    const chips: MessageAttachment[] = [
      {
        name: "demo",
        source: "attach",
        type: "text",
        content: null,
        skillName: "demo",
        action: "skillAttach",
      },
    ];
    const merged = attachmentScanner.mergeScannedSkills(
      text,
      attachmentScanner.mergeScannedAtPaths(text, chips),
    );
    const skills = merged.filter((a) => a.action === "skillAttach");
    const paths = merged.filter((a) => a.action !== "skillAttach");
    assert.equal(skills.length, 1);
    assert.equal(paths.length, 1);
    assert.equal(paths[0]!.path, "/a.md");
  });

  it("合并去重：草稿态已有 chip 时正文同名不新增（已有条目原样保留，与 @ 先例一致）", () => {
    const chip = (name: string): MessageAttachment => ({
      name,
      source: "attach",
      type: "text",
      content: null,
      skillName: name,
      action: "skillAttach",
    });
    const merged = attachmentScanner.mergeScannedSkills("再提 $demo", [
      chip("demo"),
      chip("demo"),
    ]);
    // merge 不动已有条目（含草稿态重复），但正文扫描不会新增第三条
    assert.equal(
      merged.filter((a) => a.action === "skillAttach").length,
      2,
    );
    // 换成单 chip：正文同名同样不新增
    const single = attachmentScanner.mergeScannedSkills("再提 $demo", [
      chip("demo"),
    ]);
    assert.equal(
      single.filter((a) => a.action === "skillAttach").length,
      1,
    );
  });
});

describe("F-A4: mobile 双终止符明文 `$skill$` 在 core 扫描下照常可用（实现零改动）", () => {
  it("行首 `$写文档$` → skill 写文档（终止符被字符类挡在名字外）", () => {
    const scanned = attachmentScanner.scanSkills("$写文档$ 就好");
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0]!.skillName, "写文档");
    assert.equal(scanned[0]!.action, "skillAttach");
  });

  it("夹在中文中间（无前置空白）→ 不挂附件，正文照常入库", () => {
    assert.equal(attachmentScanner.scanSkills("帮我$写文档$总结").length, 0);
  });
});
