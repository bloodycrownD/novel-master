/**
 * 发送链区间掩码（D9）：全量扫描前把确认胶囊区间替换成**等长空白**。
 *
 * 背景：chip 模型（D8）插入不产生任何分隔空格，正文会出现贴邻 token
 * （`$A$B` / `@docs/a.md$写作`）。core 两条全量扫描正则按历史口径识别——
 * `$` 需要 `(?<!\S)` 空白/行首边界、`@path` 不把 `$` 当终止符——直接全量扫描
 * 会漏挂第二颗技能、把 `$技能` 并进路径，且污染路径与正确路径的去重 key
 * 不同（`/docs/a.md$写作` ≠ `/docs/a.md`），合并去重救不回来。
 *
 * 修法：区间为权威。发送侧（mobile）先逐区间 `slice` 单独扫描得到区间结果
 * （附件经 `options.attachments` 传入，`source === 'attach'`），本模块把同一批
 * 区间在正文里替换成等长空白，供 core 的全量扫描使用——掩码后全量扫描天然
 * 看不到胶囊内触发符，污染在源头消失；区间外的手输 token 原样可扫。
 *
 * **下标不变**是硬约束：掩码只做逐段同长度替换，正文（落库 body）仍用原
 * `text`，掩码文本只喂给扫描函数。
 *
 * 越界区间夹取到 `[0, text.length]`；重叠区间（非法数据）只保留排序后先覆盖
 * 到的一段，端点相接的相邻区间照常各自掩码（`$A$B` 的 `$` 会全部消失）。
 *
 * @module domain/chat/logic/mask-composer-scan-ranges
 */

import type { ComposerDraftTokenRange } from "../model/composer-draft.schema.js";

/**
 * 返回与 `text` **等长**的扫描文本：每个确认区间替换为等量空格，其余字符不变。
 *
 * `excludedRanges` 缺失/为空/全部非法 → 原样返回 `text`（引用同一字符串，
 * 无区间时零分配、行为与 D9 之前逐字节一致）。
 */
export function maskComposerScanRanges(
  text: string,
  excludedRanges: readonly ComposerDraftTokenRange[] | undefined
): string {
  const ranges = normalizeRanges(text.length, excludedRanges);
  if (ranges.length === 0) {
    return text;
  }
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
 * 夹取并排序区间；丢弃非法/零长度/重叠区间（端点相接不算重叠，必须各自
 * 掩码——否则 `$A$B` 相邻区间并成一段也只是都变空格，结果等价，但保留
 * 独立区间让语义与「区间为权威」一致）。
 */
function normalizeRanges(
  textLength: number,
  ranges: readonly ComposerDraftTokenRange[] | undefined
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
      clamped.push({ start, end });
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
