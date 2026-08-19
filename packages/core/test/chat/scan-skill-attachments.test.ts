/**
 * T-SK11（扫描侧）：手输 `$技能名` 扫描 / 前导边界 / 字符集 / 去重 /
 * 不存在技能名容错（扫描不查存在性，未知名照常落库、不阻塞发送）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeAttachmentsWithScannedSkills,
  scanSkillAttachments,
  skillSeenKey,
} from "../../src/domain/chat/logic/scan-skill-attachments.js";
import { mergeAttachmentsWithScannedAtPaths } from "../../src/domain/chat/logic/scan-at-path-attachments.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

describe("scanSkillAttachments (T-SK11)", () => {
  it("正文含 `$技能名` → skillAttach 附件（无 path，skillName/name 同值，token 保留）", () => {
    const text = "用 $demo-skill 帮我改";
    const scanned = scanSkillAttachments(text);
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
    assert.equal(scanSkillAttachments("$foo").length, 1);
    assert.equal(scanSkillAttachments("用 $foo").length, 1);
    assert.equal(scanSkillAttachments("用\t$foo").length, 1);
    assert.equal(scanSkillAttachments("用\n$foo").length, 1);
    // `$` 前是非空白字符 → 正文片段，不扫描
    assert.equal(scanSkillAttachments("a$b").length, 0);
    assert.equal(scanSkillAttachments("$$b").length, 0);
    assert.equal(scanSkillAttachments("价格$100").length, 0);
  });

  it("字符集：`$` 后遇空白/$/@ 停扫；$/x、$@x 不落库；$foo/bar 取 foo", () => {
    assert.deepEqual(scanSkillAttachments("$foo bar").map((a) => a.skillName), [
      "foo",
    ]);
    assert.equal(scanSkillAttachments("$/foo").length, 0);
    assert.equal(scanSkillAttachments("$@foo").length, 0);
    // `/` 停扫（避免与 @path token 相互吞噬）
    assert.deepEqual(scanSkillAttachments("$foo/bar").map((a) => a.skillName), [
      "foo",
    ]);
    // 非法技能名形态（首字符 `.`）视作正文跳过
    assert.equal(scanSkillAttachments("$..x").length, 0);
    assert.equal(scanSkillAttachments("$.hidden").length, 0);
  });

  it("同名去重；skillSeenKey 与去重键同形", () => {
    const scanned = scanSkillAttachments("先 $foo 再 $foo 最后 $foo");
    assert.equal(scanned.length, 1);
    assert.equal(skillSeenKey("foo"), "skill:foo");
  });

  it("不存在技能名容错：扫描不查存在性，未知名照常落库", () => {
    const scanned = scanSkillAttachments("调 $no-such-skill 试试");
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
    const merged = mergeAttachmentsWithScannedSkills(
      text,
      mergeAttachmentsWithScannedAtPaths(text, chips),
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
    const merged = mergeAttachmentsWithScannedSkills("再提 $demo", [
      chip("demo"),
      chip("demo"),
    ]);
    // merge 不动已有条目（含草稿态重复），但正文扫描不会新增第三条
    assert.equal(
      merged.filter((a) => a.action === "skillAttach").length,
      2,
    );
    // 换成单 chip：正文同名同样不新增
    const single = mergeAttachmentsWithScannedSkills("再提 $demo", [
      chip("demo"),
    ]);
    assert.equal(
      single.filter((a) => a.action === "skillAttach").length,
      1,
    );
  });
});
