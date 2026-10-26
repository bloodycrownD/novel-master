/**
 * 智能排序规则 YAML 导入通道的错误归一（c1 P2-6）。
 *
 * 这段「存储/事务类故障原样上抛、其余套『YAML 无效』前缀」的判据，此前在
 * desktop（`src/main/services/smart-sort-rule-yaml.service.ts`）与 mobile
 * （`src/services/smart-sort-rule-yaml.service.ts`）**各抄了一份字面量三元**。
 * 两份都写 ⇒ 两份都会漂：任一端被改坏，另一端照样绿，而旧测试
 * （`test/common/storage-failure-bypass.test.ts`）只**重演**这段三元、断言两个
 * 纯函数各自的行为，压根没守接线——把任一端 app 的 `if (error instanceof TdbcError) throw error;`
 * 删掉，那条测试照样全绿。
 *
 * 收敛到本函数后，两端 app 只剩一次调用，`TdbcError` 的判据与
 * `normalizeYamlError` 的前缀**只有这一处**；测试也直接测它 ⇒ 测的就是真正
 * 被两端执行的那段逻辑，接线被删会立刻红。
 *
 * ⚠️ 判据按**反转**写（只让存储类绕过），不做正向白名单列举：YAML 语法错
 * （`parseText`）与 schema 校验错（`decode`）抛的都是 `ConfigDecodeError`，
 * 而它未在任何 `packages/core/src/public/*` 导出 ⇒ app 侧无法 import，按业务
 * 错误正向列举会把最常见的失败路径整类漏判成 DB 类，「YAML 无效」标签反而从
 * 主路径上消失（功能回归）。
 *
 * ⚠️ 若驱动把异常包了一层（不再 `TdbcError` 派生），本判据会失效 ⇒ 调用方的
 * 验收必须带一条「注入真实 DB 故障后 message 不含前缀」的断言兜底。
 *
 * @module common/normalize-smart-sort-import-error
 */

import { TdbcError } from "../infra/tdbc/errors.js";
import { normalizeYamlError } from "./normalize-yaml-error.js";

/** 智能排序规则 YAML 导入失败时给用户看的标签（两端 app 共用这一份字面量）。 */
const SMART_SORT_IMPORT_YAML_INVALID_LABEL = "智能排序规则 YAML 无效";

/**
 * 归一化智能排序规则 YAML 导入的错误，供两端 app 通道的 `catch` 直接 `throw`。
 *
 * - 存储/事务类故障（{@link TdbcError}）**原样返回**：`importRules` 整体包
 *   一条事务，中途失败即回滚；套上「YAML 无效」前缀会把 DB 故障误报成用户格式错误。
 * - 其余（YAML 语法错 / schema 违规）照旧套 {@link SMART_SORT_IMPORT_YAML_INVALID_LABEL} 前缀。
 *
 * @param error 通道 catch 到的原始异常。
 * @returns 应当抛出的 `Error`。存储类返回的就是原对象（未包装、未改 message），
 *   所以调用方 `throw normalizeSmartSortImportError(error)` 即可，无需再判类型。
 */
export function normalizeSmartSortImportError(error: unknown): Error {
  if (error instanceof TdbcError) {
    return error;
  }
  return normalizeYamlError(error, SMART_SORT_IMPORT_YAML_INVALID_LABEL);
}
