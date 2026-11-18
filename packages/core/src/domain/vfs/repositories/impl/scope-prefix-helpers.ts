/**
 * scope_key + 逻辑路径前缀扫描的共享拼装工具。
 *
 * entry_id 化后所有前缀扫描统一形如
 * `WHERE scope_key = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`，本模块抽出
 * 公共的 LIKE 转义片段，避免在两个 repo 里各写一份。
 *
 * 去尾斜杠 / 补尾斜杠的纯路径原语已收敛到 `common/path.ts` 的 `Path`。
 *
 * @module domain/vfs/repositories/impl/scope-prefix-helpers
 */

/** 转义 LIKE 串里的特殊字符，保证前缀匹配按字面量比较。 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
