/**
 * 「这条失败是不是存储/事务类故障」的跨端单源判据。
 *
 * 用途：YAML 导入通道的 catch 里用它决定要不要**绕过** `normalizeYamlError`
 * （那条路会把任何 `Error` 都拼上「YAML 无效」前缀，把 DB 故障误报成用户格式错误）。
 *
 * ⚠️ 判据按「反转」写（只让存储类绕过），**不做正向白名单列举**：YAML 语法错
 * （`parseText`）与 schema 校验错（`decode`）抛的都是 `ConfigDecodeError`，
 * 而它未在任何 `packages/core/src/public/*` 导出 ⇒ app 侧无法 import，
 * 按业务错误正向列举会把最常见的失败路径整类漏判成 DB 类，
 * 「YAML 无效」标签反而从主路径上消失（功能回归）。
 *
 * ⚠️ 若驱动把异常包了一层（不再 `TdbcError` 派生），本判据会失效 ⇒ 调用方的
 * 验收必须带一条「注入真实 DB 故障后 message 不含前缀」的断言兜底。
 *
 * @module common/is-storage-failure
 */

import { TdbcError } from "../infra/tdbc/errors.js";

/**
 * `true` = 存储/事务类故障（应原样上抛，不贴「YAML 无效」标签）。
 *
 * 覆盖面刻意保守：只认 {@link TdbcError}（驱动与协议层统一错误），
 * 其余一律 `false` ⇒ 照旧走 `normalizeYamlError` 的前缀包装。
 */
export function isStorageFailure(error: unknown): boolean {
  return error instanceof TdbcError;
}