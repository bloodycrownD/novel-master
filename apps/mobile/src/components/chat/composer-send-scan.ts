/**
 * 发送链区间扫描（D9 · mobile 侧）：以 Composer 确认胶囊区间为权威，逐区间
 * `slice` 出区间文本单独扫描，产出两类东西：
 *
 * 1. `attachments`：区间扫描（rangeResults）∪ 掩码全量扫描（fullScanResults）
 *    按「existing=区间」合并后的 `source: 'attach'` 附件（贴邻 chip 的
 *    `$A$$B$` 第二颗、`@path@$技能$` 的干净路径与技能、区间外手输 token）——
 *    经 `SessionStreamStartOptions.attachments` 透传，core 发送挂点再把它放在
 *    「existing 位」与自身掩码扫描结果去重合并（区间结果优先）；
 * 2. `excludedScanRanges`：同一批区间换算到 **trim 后正文** 的坐标系，供 core
 *    做全量扫描掩码（等长空白）——`@([^\s@]+)` 不再把 `$技能$` 并进路径，
 *    区间内 token 也不会被全量扫描重复挂载。
 *
 * 为什么区间扫描必须用**未 trim** 的 `sourceText`：区间下标相对草稿原文；
 * 发送正文沿用历史口径 `text.trim()`。草稿开头有空格时，区间下标必须先减去
 * trimStart 掉的字符数才能喂给 core 的掩码（越界/翻转丢弃），但区间扫描本身
 * 读原文即可（区间内触发符在 index 0，`(?<!\S)` 边界天然满足）。
 *
 * @module components/chat/composer-send-scan
 */

import {
  attachmentScanner,
  type ComposerDraftTokenRange,
  type MessageAttachment,
} from '@novel-master/core/chat';

/** 发送链区间扫描产物（空区间时为固定空对象，调用方可直接判空）。 */
export type ComposerSendScan = {
  readonly attachments: readonly MessageAttachment[];
  readonly excludedScanRanges: readonly ComposerDraftTokenRange[];
};

/** 无区间（旧草稿 / 手输无胶囊）的发送扫描结果：core 全量扫描零掩码。 */
export const EMPTY_COMPOSER_SEND_SCAN: ComposerSendScan = {
  attachments: [],
  excludedScanRanges: [],
};

/**
 * 扫描发送草稿的确认区间（D9 掩码二段式）。
 *
 * 1. **区间扫描**：每个确认区间 `slice` 出区间文本单独扫（触发符在 index 0
 *    天然过边界）→ `rangeResults`；
 * 2. **掩码全量扫描**：区间替换成**等长空白**（下标不变）后全量扫原文——
 *    区间内触发符不再参与识别，手输 token（区间外）照常可扫 →
 *    `fullScanResults`；
 * 3. **合并**：`attachmentScanner.mergeByPath(rangeResults, fullScanResults)`——
 *    该函数已有优先，区间结果必须放 existing 位。
 *
 * @param sourceText 未 trim 的草稿原文（区间下标基准）
 * @param content 发送正文（`sourceText.trim()`，core 扫描与落库 body）
 * @param ranges Composer 确认区间；`undefined` / `[]` → 空结果（历史全量扫描）
 */
export function scanComposerTokenRangesForSend(
  sourceText: string,
  content: string,
  ranges: readonly ComposerDraftTokenRange[] | undefined,
): ComposerSendScan {
  const normalized = normalizeRanges(sourceText.length, ranges);
  if (normalized.length === 0) {
    return EMPTY_COMPOSER_SEND_SCAN;
  }

  // 第 1 段：区间扫描。区间内触发符在 index 0：`$` 满足 `(?<!\S)`，`@` 到
  // 区间尾自然终止，`$技能$` 与 `@path@` 因成对切分互不吞噬。
  const rangeResults: MessageAttachment[] = [];
  for (const range of normalized) {
    const slice = sourceText.slice(range.start, range.end);
    rangeResults.push(
      ...attachmentScanner.scanAtPaths(slice),
      ...attachmentScanner.scanSkills(slice),
    );
  }

  // 第 2 段：掩码全量扫描。等长空白保证下标不变；区间外的手输 token
  // （`用 $foo$ 看 @notes/a.md@`）照常识别，贴邻触发器（`$A$$B$`）在源头消失。
  const maskedText = maskRangesWithSpaces(sourceText, normalized);
  const fullScanResults: MessageAttachment[] = [
    ...attachmentScanner.scanAtPaths(maskedText),
    ...attachmentScanner.scanSkills(maskedText),
  ];

  // 第 3 段：合并——existing=区间（区间结果优先，去重键相同则保留区间对象）。
  return {
    attachments: attachmentScanner.mergeByPath(rangeResults, fullScanResults),
    excludedScanRanges: toTrimmedCoordinates(sourceText, content, normalized),
  };
}

/** 区间替换为等长空白（下标不变；只喂扫描函数，不动正文）。 */
function maskRangesWithSpaces(
  text: string,
  ranges: readonly ComposerDraftTokenRange[],
): string {
  let masked = "";
  let cursor = 0;
  for (const range of ranges) {
    masked += text.slice(cursor, range.start);
    masked += " ".repeat(range.end - range.start);
    cursor = range.end;
  }
  return masked + text.slice(cursor);
}

/**
 * 区间换算到 trim 后正文坐标：整体左移 trimStart 字符数，`end` 夹到正文
 * 长度（尾部空白被 trim 掉）；越界/翻转/空区间丢弃。
 */
function toTrimmedCoordinates(
  sourceText: string,
  content: string,
  ranges: readonly ComposerDraftTokenRange[],
): ComposerDraftTokenRange[] {
  const leading = sourceText.length - sourceText.trimStart().length;
  const adjusted: ComposerDraftTokenRange[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - leading);
    const end = Math.min(content.length, range.end - leading);
    if (start < end) {
      adjusted.push({start, end});
    }
  }
  return adjusted;
}

/**
 * 夹取并排序区间；丢弃非法/零长度/重叠区间（端点相接的相邻区间保留——
 * `$A$$B$` 的第二颗必须作为独立区间扫描）。
 */
function normalizeRanges(
  textLength: number,
  ranges: readonly ComposerDraftTokenRange[] | undefined,
): ComposerDraftTokenRange[] {
  if (ranges == null || ranges.length === 0) {
    return [];
  }
  const clamped: ComposerDraftTokenRange[] = [];
  for (const range of ranges) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      continue;
    }
    const start = Math.max(0, range.start);
    const end = Math.min(textLength, range.end);
    if (start < end) {
      clamped.push({start, end});
    }
  }
  clamped.sort((a, b) => a.start - b.start || a.end - b.end);

  const disjoint: ComposerDraftTokenRange[] = [];
  let coveredUntil = 0;
  for (const range of clamped) {
    if (range.start < coveredUntil) {
      continue;
    }
    disjoint.push(range);
    coveredUntil = range.end;
  }
  return disjoint;
}
