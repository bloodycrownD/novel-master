/**
 * scope_key + 逻辑路径前缀扫描的共享拼装工具。
 *
 * entry_id 化后所有前缀扫描统一形如
 * `WHERE scope_key = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`，本模块抽出
 * 公共的转义 / 归一化片段，避免在两个 repo 里各写一份。
 *
 * @module domain/vfs/repositories/impl/scope-prefix-helpers
 */

/** 转义 LIKE 串里的特殊字符，保证前缀匹配按字面量比较。 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 把前缀规整成不带尾斜杠的形态（根 `/` 保留）。 */
export function normalizePrefix(prefix: string): string {
  if (prefix === "/") {
    return prefix;
  }
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}
