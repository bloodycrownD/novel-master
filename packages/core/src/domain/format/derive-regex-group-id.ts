/** 内部 regex 分组 id：由展示名推导（UI 仅输入名称）。 */

/** 稳定 slug；名称无可用字符时回退为 time-based id。 */
export function deriveRegexGroupId(
  displayName: string,
  takenIds: ReadonlySet<string>,
): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const seed =
    base.length > 0 ? base : `group-${Date.now().toString(36).slice(-8)}`;
  let candidate = seed;
  let n = 2;
  while (takenIds.has(candidate)) {
    candidate = `${seed}-${n}`;
    n += 1;
  }
  return candidate;
}
