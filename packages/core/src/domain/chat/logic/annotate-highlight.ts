/**
 * 划词批注高亮纯算法：按原文聚合 id、解析 mark 属性、长串优先排序、非重叠匹配。
 * DOM wrap 留在 Desktop `preview-annotate` / Mobile `annotate-marks`。
 *
 * @module domain/chat/logic/annotate-highlight
 */

/** 非重叠查找 needle 在 haystack 中的全部起始下标。 */
export function findAllOccurrences(
  haystack: string,
  needle: string,
): number[] {
  if (needle.length === 0) {
    return [];
  }
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    out.push(at);
    from = at + needle.length;
  }
  return out;
}

/**
 * 按 originalText 聚合 draft id（同文多条共用一处下划线点击）。
 * 空 text 或空 id 跳过（采 Mobile 更严规则）。
 */
export function groupAnnotateIdsByOriginalText(
  drafts: readonly { readonly id: string; readonly originalText: string }[],
): Map<string, string[]> {
  const byText = new Map<string, string[]>();
  for (const d of drafts) {
    const text = d.originalText;
    if (!text || !d.id) {
      continue;
    }
    const list = byText.get(text);
    if (list == null) {
      byText.set(text, [d.id]);
    } else {
      list.push(d.id);
    }
  }
  return byText;
}

/** 解析 mark 上的 id 列表。 */
export function parseAnnotateIdsAttr(raw: string | null | undefined): string[] {
  if (raw == null || raw === "") {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 应用顺序：originalText 长度降序（长优先），重叠/嵌套时避免短针抢占。
 */
export function sortAnnotateTextsLongestFirst(
  texts: readonly string[],
): string[] {
  return [...texts].sort((a, b) => b.length - a.length);
}
