/**
 * T-CA9（D9 发送链区间感知 · core 掩码侧）：确认区间掩码为等长空白后再全量扫描。
 *
 * 掩码是「区间为权威」在 core 的落点：区间内触发符不参与全量扫描（贴邻第二颗
 * `$` 不重复挂、`@path$技能` 不把 `$技能` 并进路径），区间外手输 token 原样可扫。
 * 等长是硬约束——落库正文用原文，掩码文本只喂扫描函数。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskComposerScanRanges } from "../../src/domain/chat/logic/mask-composer-scan-ranges.js";
import {
  mergeAttachmentsWithScannedAtPaths,
  scanAtPathAttachments,
} from "../../src/domain/chat/logic/scan-at-path-attachments.js";
import {
  mergeAttachmentsWithScannedSkills,
  scanSkillAttachments,
} from "../../src/domain/chat/logic/scan-skill-attachments.js";
import type { ComposerDraftTokenRange } from "../../src/domain/chat/model/composer-draft.schema.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";

/** D9 的全量扫描口径：掩码后跑两条扫描（与 run-agent-turn 挂点同序）。 */
function fullScanMasked(
  text: string,
  excluded: readonly ComposerDraftTokenRange[] | undefined,
  existing: readonly MessageAttachment[] = []
): MessageAttachment[] {
  const scanText = maskComposerScanRanges(text, excluded);
  return mergeAttachmentsWithScannedSkills(
    scanText,
    mergeAttachmentsWithScannedAtPaths(scanText, existing)
  );
}

/** 发送侧（mobile）的区间扫描口径：逐区间 slice 单独扫。 */
function scanTokenRanges(
  text: string,
  ranges: readonly ComposerDraftTokenRange[]
): MessageAttachment[] {
  const out: MessageAttachment[] = [];
  for (const range of ranges) {
    const slice = text.slice(range.start, range.end);
    out.push(...scanAtPathAttachments(slice), ...scanSkillAttachments(slice));
  }
  return out;
}

function skillNames(attachments: readonly MessageAttachment[]): string[] {
  return attachments
    .filter((a) => a.action === "skillAttach")
    .map((a) => a.skillName!)
    .sort();
}

describe("maskComposerScanRanges (T-CA9 · core)", () => {
  it("无区间 / 空数组 → 原样返回同一字符串（零分配、历史行为不变）", () => {
    const text = "用 $foo 看 @notes/a.md";
    assert.equal(maskComposerScanRanges(text, undefined), text);
    assert.equal(maskComposerScanRanges(text, []), text);
  });

  it("等长替换：区间内每个码元变空格，正文长度与下标不变", () => {
    const text = "$agent-config$节拍成章";
    const masked = maskComposerScanRanges(text, [
      { start: 0, end: 13 },
      { start: 13, end: 18 },
    ]);
    assert.equal(masked.length, text.length);
    assert.equal(masked.trim(), "");
    assert.equal(masked, " ".repeat(text.length));
  });

  it("① `$agent-config$节拍成章`：掩码后全量扫描不再认区间内 token；区间扫描两颗都挂", () => {
    const text = "$agent-config$节拍成章";
    const ranges: ComposerDraftTokenRange[] = [
      { start: 0, end: 13 },
      { start: 13, end: 18 },
    ];
    assert.deepEqual(skillNames(fullScanMasked(text, ranges)), []);
    assert.deepEqual(skillNames(scanTokenRanges(text, ranges)), [
      "agent-config",
      "节拍成章",
    ]);
  });

  it("② `@docs/a.md$写作`：掩码后全量扫描不再产出污染路径；区间扫描路径干净", () => {
    const text = "@docs/a.md$写作";
    const ranges: ComposerDraftTokenRange[] = [
      { start: 0, end: 10 },
      { start: 10, end: 13 },
    ];
    assert.deepEqual(fullScanMasked(text, ranges), []);
    const ranged = scanTokenRanges(text, ranges);
    assert.deepEqual(
      ranged.filter((a) => a.path != null).map((a) => a.path),
      ["/docs/a.md"]
    );
    assert.deepEqual(skillNames(ranged), ["写作"]);
  });

  it("区间外的手输 token 仍可全量扫描（掩码只盖区间）", () => {
    const text = "$A$B 手输 $C 与 @notes/a.md";
    const masked = maskComposerScanRanges(text, [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    assert.equal(masked.length, text.length);
    // `$A$B` 变空格；后面的 `$C` / `@notes/a.md` 原样保留
    assert.ok(masked.endsWith(" 手输 $C 与 @notes/a.md"));
    assert.deepEqual(skillNames(fullScanMasked(text, [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])), ["C"]);
    assert.deepEqual(
      fullScanMasked(text, [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ])
        .filter((a) => a.path != null)
        .map((a) => a.path),
      ["/notes/a.md"]
    );
  });

  it("区间结果优先：掩码后合并（existing 位）保留区间扫描对象，区间外结果追加", () => {
    const text = "$A$B 手输 $A";
    const ranges: ComposerDraftTokenRange[] = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];
    const ranged = scanTokenRanges(text, ranges);
    const merged = fullScanMasked(text, ranges, ranged);
    assert.deepEqual(skillNames(merged), ["A", "B"]);
    // 区间结果先入：A 来自区间对象而非掩码后全量扫描的 `$A`
    assert.equal(merged[0]!.skillName, "A");
  });

  it("越界区间夹取；重叠区间只保留先覆盖到的一段", () => {
    const text = "$A$B";
    assert.equal(
      maskComposerScanRanges(text, [{ start: 0, end: 999 }]),
      " ".repeat(text.length)
    );
    // 第二个区间与前一个重叠 → 被丢弃；第一个区间已覆盖 [0,2)
    assert.equal(
      maskComposerScanRanges(text, [
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ]),
      `  $B`
    );
    // 完全越界 / 非整数 → 视作无区间
    assert.equal(
      maskComposerScanRanges(text, [
        { start: 99, end: 120 },
        { start: 1.5, end: 3 },
      ]),
      text
    );
  });
});
