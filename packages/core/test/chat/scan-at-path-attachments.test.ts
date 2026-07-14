/**
 * T-AT5 / T-AT6：手输 @path 扫描与 path 去重。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeAttachmentsWithScannedAtPaths,
  scanAtPathAttachments,
} from "../../src/domain/chat/logic/scan-at-path-attachments.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

describe("scanAtPathAttachments (T-AT5 / T-AT6)", () => {
  it("T-AT5: 正文含手输 @path 且 chips 无该 path → 生成 source:attach", () => {
    const text = "请看 @notes/a.md 与补充";
    const scanned = scanAtPathAttachments(text);
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0]!.source, "attach");
    assert.equal(scanned[0]!.path, "notes/a.md");
    assert.match(text, /@notes\/a\.md/);
  });

  it("T-AT5: 合并后 content 仍含 @path token（未剥离）", () => {
    const text = "见 @notes/a.md";
    const chips: MessageAttachment[] = [];
    const merged = mergeAttachmentsWithScannedAtPaths(text, chips);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.path, "notes/a.md");
    assert.ok(text.includes("@notes/a.md"));
  });

  it("T-AT6: chips 已有 path 且正文再写同一 @path → 去重仅一条", () => {
    const text = "再提 @notes/a.md";
    const chips: MessageAttachment[] = [
      {
        name: "a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "notes/a.md",
      },
    ];
    const merged = mergeAttachmentsWithScannedAtPaths(text, chips);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.path, "notes/a.md");
  });

  it("允许多个不同 path 与中文路径", () => {
    const text = "见 @docs/说明.md 和 @foo/bar.txt";
    const scanned = scanAtPathAttachments(text);
    assert.equal(scanned.length, 2);
    assert.deepEqual(
      scanned.map((a) => a.path).sort(),
      ["docs/说明.md", "foo/bar.txt"],
    );
  });
});
