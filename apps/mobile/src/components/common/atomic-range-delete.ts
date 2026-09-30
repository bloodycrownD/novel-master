/** 原子删候选区间：可被「单次连续删除整段摘除」的目标 span。 */
export type AtomicDeleteRange = {
  readonly start: number;
  readonly end: number;
};

/**
 * 泛化原子删：单次连续删除若碰到候选区间，整段删掉。
 *
 * 算法骨架（与原 `tryAtomicMacroDelete` 一致，仅把「宏白名单区间」参数化）：
 * 1. `next` 不短于 `prev` 视为非删除，返回 null；
 * 2. 公共前缀推进得 prefix，删除窗为 `[prefix, prefix + deletedCount]`；
 * 3. 尾段对账：`prev.slice(deleteEnd)` 必须严格等于 `next.slice(deleteStart)`，
 *    否则不是单段连续删除（多处不连续删/改写），返回 null；
 * 4. 与删除窗相交（`deleteStart < r.end && deleteEnd > r.start`）的第一个区间命中；
 * 5. 删除已覆盖整段区间时返回 null，交给调用方默认差分；
 * 6. 否则返回 `prev` 去掉整个命中区间的新串。
 *
 * @returns 整段删除后的新串；无需原子删拦截时返回 null
 */
export function tryAtomicRangeDelete(
  prev: string,
  next: string,
  ranges: readonly AtomicDeleteRange[],
): string | null {
  if (next.length >= prev.length) {
    return null;
  }

  let prefix = 0;
  const minLen = Math.min(next.length, prev.length);
  while (prefix < minLen && next[prefix] === prev[prefix]) {
    prefix++;
  }

  const deletedCount = prev.length - next.length;
  const deleteStart = prefix;
  const deleteEnd = deleteStart + deletedCount;
  if (prev.slice(deleteEnd) !== next.slice(deleteStart)) {
    return null;
  }

  const hitRange = ranges.find(
    range => deleteStart < range.end && deleteEnd > range.start,
  );
  if (hitRange == null) {
    return null;
  }

  // 删除已覆盖整段区间：交给默认差分即可
  if (deleteStart <= hitRange.start && deleteEnd >= hitRange.end) {
    return null;
  }

  return prev.slice(0, hitRange.start) + prev.slice(hitRange.end);
}
