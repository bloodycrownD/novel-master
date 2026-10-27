/**
 * Composer `@路径` 插入 / typeahead / 扫描门闩（迁并双端 T-ATD*；T-X2-2）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentScanner } from "../../src/domain/chat/logic/attachment/attachment-scanner.js";
import { composerAtPath } from "../../src/domain/chat/logic/composer/composer-at-path.js";

describe("composer-at-path", () => {
  it("T-ATD2: Picker token 为 @path；目录尾 /；扫描落库带前导 /", () => {
    const tokens = composerAtPath.tokensFromPickerSelection(["/notes"], ["/a.md"]);
    assert.deepEqual(tokens, ["@/notes/", "@/a.md"]);
    const scanned = attachmentScanner.scanAtPaths(tokens.join(" "));
    assert.equal(scanned.length, 2);
    assert.equal(scanned[0]!.path, "/notes/");
    assert.equal(scanned[0]!.type, "dir");
    assert.equal(scanned[1]!.path, "/a.md");
    assert.ok(scanned.every((a) => a.path!.startsWith("/")));
  });

  it("T-ATD3: 手输 @ 搜索 ≤5，点选替换为完整 @path", () => {
    const active = composerAtPath.detectQuery("见 @ab", 5);
    assert.ok(active);
    assert.equal(active!.query, "ab");
    const token = composerAtPath.formatToken("/ab.md", false);
    const next = composerAtPath.replaceToken("见 @ab", 5, active!.start, token);
    assert.equal(next.text, "见 @/ab.md ");
  });

  it("findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭", () => {
    const bare = "@/a.md";
    assert.ok(composerAtPath.detectQuery(bare, bare.length));
    assert.equal(composerAtPath.detectQuery(bare, bare.length)!.query, "/a.md");
    assert.equal(composerAtPath.detectQuery(`${bare} `, `${bare} `.length), null);
  });

  it("T-SK11: trigger 缺省 '@'（既有行为回归锁死）；'$' 查询同语义", () => {
    // 缺省 trigger='@'：既有调用行为不变
    const active = composerAtPath.detectQuery("见 @ab", 5);
    assert.ok(active);
    assert.equal(active!.query, "ab");
    assert.equal(active!.start, 2);
    assert.equal(composerAtPath.detectQuery("@", 1)!.query, "");
  });

  it("T-SK11: trigger='$' 查询与 '@' 同语义；前导边界与触发字符互不串扰", () => {
    const active = composerAtPath.detectQuery("用 $de", 5, "$");
    assert.ok(active);
    assert.equal(active!.query, "de");
    assert.equal(active!.start, 2);
    // '@' 文本在 '$' 触发下不激活（反之亦然）
    assert.equal(composerAtPath.detectQuery("见 @ab", 5, "$"), null);
    assert.equal(composerAtPath.detectQuery("用 $de", 5, "@"), null);
    // 前导边界：触发字符前须为空白/行首；带尾空格则关闭
    assert.equal(composerAtPath.detectQuery("a$b", 3, "$"), null);
    assert.equal(composerAtPath.detectQuery("用 $de ", 6, "$"), null);
  });

  it("T-ATD4: 删除正文 @path 后扫描为空", () => {
    assert.equal(attachmentScanner.scanAtPaths("看 @/a.md").length, 1);
    assert.equal(attachmentScanner.scanAtPaths("看").length, 0);
  });
});

describe("F-A6: 终止符右侧光标不弹候选（触发符前须空白）", () => {
  it("光标停在整串末尾 / 终止符右侧 → detectQuery 返回 null", () => {
    assert.equal(composerAtPath.detectQuery("$写文档$总结", 7, "$"), null);
    assert.equal(composerAtPath.detectQuery("$写文档$", 5, "$"), null);
  });
});
