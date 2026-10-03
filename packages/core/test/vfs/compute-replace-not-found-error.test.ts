/**
 * compute-replace-not-found-error 单测：重点验证预览（preview）诊断字段。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplaceNotFoundError } from "../../src/domain/vfs/logic/compute-replace-not-found-error.js";
import { isVfsError } from "../../src/errors/vfs-errors.js";

describe("buildReplaceNotFoundError", () => {
  it("details 里带上 oldString 和 fileHint 的文本预览", () => {
    // 模拟典型场景：oldString 里是字面 &ldquo; entity，
    // 文件里则是真正的“，肉眼相似但字符完全不同——预览并列即可看出。
    const fileContent = "“你好世界”这是一段正文";
    const oldString = "&ldquo;你好世界&rdquo;";
    const err = buildReplaceNotFoundError("/note.md", fileContent, oldString);

    assert.ok(isVfsError(err, "REPLACE_NOT_FOUND"));
    const details = err.details as {
      oldStringPreview?: string;
      fileHintPreview?: string;
    };

    // oldString 预览开头就是字面 entity，能直接看出没被反转义。
    assert.ok(details.oldStringPreview?.startsWith("&ldquo;"));
    // fileHint 从 LCS 锚点（"你好世界"）开始截，所以以「你」开头，
    // 而不是文件开头的 “——这点诊断时要注意。
    assert.ok(details.fileHintPreview?.startsWith("你好世界"));
    // 「你好」两个字符两边都该出现，证明两边确实有共同片段。
    assert.ok(details.oldStringPreview?.includes("你好"));
    assert.ok(details.fileHintPreview?.includes("你好"));
  });

  it("oldString 完全无关时 fileHint 回退到文件开头", () => {
    // 没有任何公共子串时，fileHint 取 fileContent 前 100 字符，
    // 这样诊断信息仍能给出文件起点的文本供对比。
    const fileContent = "AAAAAAAAAAAAAAAA";
    const oldString = "ZZZZZZZZZZZZZZZZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, oldString);
    const details = err.details as { fileHintPreview?: string };
    assert.equal(details.fileHintPreview, "A".repeat(16));
  });

  it("预览上限 100 字符，避免错误信息过长", () => {
    const longOld = "你".repeat(250);
    const fileContent = "XYZXYZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, longOld);
    const details = err.details as { oldStringPreview?: string };
    // 250 个「你」只该输出 100 个（按码点截，代理对不会切半）。
    assert.equal(details.oldStringPreview, "你".repeat(100));
  });

  it("emoji 代理对按完整字符保留，不会被切成两半", () => {
    // 😀 是 U+1F600，UTF-16 里是代理对。Array.from 拆分会把它当成单个码点，
    // 预览里应保留完整 😀 而不是半个代理对（否则 JSON.stringify 会产出 \ud83d 转义）。
    const fileContent = "😀abc";
    const oldString = "ZZZ";
    const err = buildReplaceNotFoundError("/x.md", fileContent, oldString);
    const details = err.details as { fileHintPreview?: string };
    assert.ok(details.fileHintPreview?.startsWith("😀abc"));
    // 转义后不得出现孤立代理对转义（半个 emoji 被切开的标志）。
    assert.ok(!JSON.stringify(details.fileHintPreview).includes("\\ud"));
  });

  it("预览保住不可见字符（换行/制表原样进 details，由 formatter 转义显形）", () => {
    const fileContent = "line1\nline2\ttab";
    const oldString = "line1 line2";
    const err = buildReplaceNotFoundError("/x.md", fileContent, oldString);
    const details = err.details as { fileHintPreview?: string };
    // 预览是原始文本：换行/制表保留在字符串里，formatter JSON.stringify 后显形为 \n、\t。
    assert.ok(details.fileHintPreview?.includes("\n"));
    assert.ok(details.fileHintPreview?.includes("\t"));
  });

  it("S4: 1MB 正文 + 1MB oldString 走降级路径，诊断契约仍完整（错误码/lcsLength/fileHint）", () => {
    // C2-11 S4（原始修法见 fix-spec/wave-c2.md §C2-11 测试策略）。
    // 钉的是**降级路径**下的诊断契约：DP 上限 2e6 格，1MB × 1MB = 1e12 格远超
    // 上限 ⇒ 必然走 `longestCommonSubstring` 的降级分支（按同一比例裁两侧）。
    // 把降级阈值调到任意大小、或把 fileHint 算空，本条都必须红——
    // 「大文件 edit 未命中时诊断长期为空」是 S1/S2/S3 覆盖不到的残余风险面。
    //
    // 正文全 A、oldString 全 B ⇒ 两侧字符集不相交，无论裁不裁都真的没有公共
    // 子串，所以 lcsLength === 0 是**如实**结果而不是降级把诊断算空了。
    const fileContent = "A".repeat(1024 * 1024);
    const oldString = "B".repeat(1024 * 1024);

    // 走公开入口（buildReplaceNotFoundError），不碰 LCS 内部实现。
    assert.throws(
      () => {
        throw buildReplaceNotFoundError("/big.md", fileContent, oldString);
      },
      (e: unknown) => {
        // ① 错误码字面量：降级不得改动对外错误码。
        assert.ok(isVfsError(e, "REPLACE_NOT_FOUND"), "降级后错误码仍是 REPLACE_NOT_FOUND");
        assert.equal(e.code, "REPLACE_NOT_FOUND");
        assert.equal(e.path, "/big.md");

        const details = e.details as {
          longestCommonSubstring?: string;
          lcsLength?: number;
          fileHintPreview?: string;
        };
        // ② 两侧字符集不相交 ⇒ 公共子串长度必为 0（降级后的诚实结果）。
        assert.equal(details.lcsLength, 0);
        assert.equal(details.longestCommonSubstring, "");
        // ③ fileHint 必须非空：诊断面板要给得出可比对的文本，否则用户侧无从下手。
        assert.ok(
          typeof details.fileHintPreview === "string" &&
            details.fileHintPreview.length > 0,
          `降级后 fileHint 不得为空，实际 ${JSON.stringify(details.fileHintPreview)}`
        );
        // fileHint 回退到文件开头 100 字符。
        assert.equal(details.fileHintPreview, "A".repeat(100));
        return true;
      }
    );
  });
});
