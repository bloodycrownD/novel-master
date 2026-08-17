/**
 * Composer `@路径` 插入 / typeahead / 扫描门闩（迁并双端 T-ATD*；T-X2-2）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanAtPathAttachments } from "../../src/domain/chat/logic/scan-at-path-attachments.js";
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from "../../src/domain/chat/logic/composer-at-path.js";

describe("composer-at-path", () => {
  it("T-ATD2: Picker token 为 @path；目录尾 /；扫描落库带前导 /", () => {
    const tokens = atPathTokensFromPickerSelection(["/notes"], ["/a.md"]);
    assert.deepEqual(tokens, ["@/notes/", "@/a.md"]);
    const scanned = scanAtPathAttachments(tokens.join(" "));
    assert.equal(scanned.length, 2);
    assert.equal(scanned[0]!.path, "/notes/");
    assert.equal(scanned[0]!.type, "dir");
    assert.equal(scanned[1]!.path, "/a.md");
    assert.ok(scanned.every((a) => a.path!.startsWith("/")));
  });

  it("T-ATD3: 手输 @ 搜索 ≤5，点选替换为完整 @path", () => {
    const refs = [
      { path: "/a.md", kind: "file" as const },
      { path: "/ab.md", kind: "file" as const },
      { path: "/abc.md", kind: "file" as const },
      { path: "/abcd.md", kind: "file" as const },
      { path: "/abcde.md", kind: "file" as const },
      { path: "/abcdef.md", kind: "file" as const },
    ];
    assert.equal(filterAtPathTypeaheadCandidates(refs, "a", 5).length, 5);

    const active = findActiveAtQuery("见 @ab", 5);
    assert.ok(active);
    assert.equal(active!.query, "ab");
    const token = formatComposerAtPathToken("/ab.md", false);
    const next = replaceActiveAtWithToken("见 @ab", 5, active!.start, token);
    assert.equal(next.text, "见 @/ab.md ");
  });

  it("findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭", () => {
    const bare = "@/a.md";
    assert.ok(findActiveAtQuery(bare, bare.length));
    assert.equal(findActiveAtQuery(bare, bare.length)!.query, "/a.md");
    assert.equal(findActiveAtQuery(`${bare} `, `${bare} `.length), null);
  });

  it("T-SK11: trigger 缺省 '@'（既有行为回归锁死）；'$' 查询同语义", () => {
    // 缺省 trigger='@'：既有调用行为不变
    const active = findActiveAtQuery("见 @ab", 5);
    assert.ok(active);
    assert.equal(active!.query, "ab");
    assert.equal(active!.start, 2);
    assert.equal(findActiveAtQuery("@", 1)!.query, "");
  });

  it("T-SK11: trigger='$' 查询与 '@' 同语义；前导边界与触发字符互不串扰", () => {
    const active = findActiveAtQuery("用 $de", 5, "$");
    assert.ok(active);
    assert.equal(active!.query, "de");
    assert.equal(active!.start, 2);
    // '@' 文本在 '$' 触发下不激活（反之亦然）
    assert.equal(findActiveAtQuery("见 @ab", 5, "$"), null);
    assert.equal(findActiveAtQuery("用 $de", 5, "@"), null);
    // 前导边界：触发字符前须为空白/行首；带尾空格则关闭
    assert.equal(findActiveAtQuery("a$b", 3, "$"), null);
    assert.equal(findActiveAtQuery("用 $de ", 6, "$"), null);
  });

  it("T-ATD4: 删除正文 @path 后扫描为空", () => {
    assert.equal(countScannedAtPathAttachments("看 @/a.md"), 1);
    assert.equal(countScannedAtPathAttachments("看"), 0);
  });

  it("filterAtPathTypeaheadCandidates: 跳过根 /；空 query 仍可返回", () => {
    const refs = [
      { path: "/", kind: "dir" as const },
      { path: "/notes", kind: "dir" as const },
      { path: "/a.md", kind: "file" as const },
    ];
    const hits = filterAtPathTypeaheadCandidates(refs, "", 5);
    assert.equal(hits.length, 2);
    assert.ok(hits.every((r) => r.path !== "/"));
  });
});
