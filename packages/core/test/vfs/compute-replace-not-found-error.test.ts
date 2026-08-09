/**
 * compute-replace-not-found-error 单测：重点验证 codepoint 诊断字段。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplaceNotFoundError } from "../../src/domain/vfs/logic/compute-replace-not-found-error.js";
import { isVfsError } from "../../src/errors/vfs-errors.js";

describe("buildReplaceNotFoundError", () => {
  it("details 里带上 oldString 和 fileHint 的 codepoint 转储", () => {
    // 模拟 bug 3 的典型场景：oldString 里是字面 &ldquo; entity，
    // 文件里则是真正的“，肉眼相似但码点完全不同。
    const fileContent = "“你好世界”这是一段正文";
    const oldString = "&ldquo;你好世界&rdquo;";
    const err = buildReplaceNotFoundError("/note.md", fileContent, oldString);

    assert.ok(isVfsError(err, "REPLACE_NOT_FOUND"));
    const details = err.details as {
      oldStringCodepoints?: string;
      fileHintCodepoints?: string;
    };

    // oldString 开头是 & 的码点 26，能直接看出 entity 没被反转义。
    assert.ok(details.oldStringCodepoints?.startsWith("26 "));
    // fileHint 从 LCS 锚点（"你好世界"）开始截，所以以 你(4f60) 开头，
    // 而不是文件开头的 “(201c)——这点诊断时要注意。
    assert.ok(details.fileHintCodepoints?.startsWith("4f60"));
    // 你(4f60) 好(597d) 两个码点两边都该出现，证明两边确实有共同片段。
    assert.ok(details.oldStringCodepoints?.includes("4f60 597d"));
    assert.ok(details.fileHintCodepoints?.includes("4f60 597d"));
  });

  it("oldString 完全无关时 fileHint 回退到文件开头", () => {
    // 没有任何公共子串时，fileHint 取 fileContent 前 100 字符，
    // 这样诊断信息仍能给出文件起点的码点供对比。
    // 这里文件只有 16 个 A，所以 fileHint 也只有 16 个码点。
    const fileContent = "AAAAAAAAAAAAAAAA";
    const oldString = "ZZZZZZZZZZZZZZZZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, oldString);
    const details = err.details as { fileHintCodepoints?: string };
    // A 的码点是 41，16 个 A 对应 16 个 41。
    assert.equal(details.fileHintCodepoints, "41 ".repeat(16).trim());
  });

  it("codepoint 转储上限 100 字符，避免错误信息过长", () => {
    const longOld = "你".repeat(250);
    const fileContent = "XYZXYZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, longOld);
    const details = err.details as { oldStringCodepoints?: string };
    // 250 个“你”只该输出 100 个 4f60。
    const parts = details.oldStringCodepoints?.split(" ") ?? [];
    assert.equal(parts.length, 100);
    assert.ok(parts.every((cp) => cp === "4f60"));
  });

  it("emoji 代理对按完整码点输出，不会被切成两半", () => {
    // 😀 是 U+1F600，UTF-16 里是代理对。Array.from 拆分会把它当成单个码点。
    const fileContent = "😀abc";
    const oldString = "ZZZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, oldString);
    const details = err.details as { fileHintCodepoints?: string };
    // 第一个码点是 1f600，而不是 d83d（高位代理）。
    assert.ok(details.fileHintCodepoints?.startsWith("1f600 "));
  });
});
