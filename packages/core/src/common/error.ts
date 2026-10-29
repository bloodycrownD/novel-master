/**
 * 错误归一层：把任意抛出的值变成「可读文案」或「带上下文的 Error」。
 *
 * 三个函数同属一类职责——输入是 `unknown` 异常，输出是确定性文本/Error，
 * 绝不抛错，所以放同一个类别文件，不再各开单函数文件。
 *
 * @module common/error
 */

import {TdbcError} from "../infra/tdbc/errors.js";

/** 智能排序规则 YAML 导入失败时给用户看的标签（两端 app 共用这一份字面量）。 */
const SMART_SORT_IMPORT_YAML_INVALID_LABEL = "智能排序规则 YAML 无效";

/**
 * 取错误文案：`Error` 取其 `message`，其余（含 `null`、字符串、对象）一律
 * `String()` 化。
 *
 * @remarks 告警/失败原因文案的统一取法。此前散落多份逐字相同的私有副本
 *   （zlib-accelerator 的回落告警、pack-codec 的段解码失败摘要等），改动
 *   文案时容易漏改其中一份。口径固定为「Error 取 message，其余一律
 *   String 化」——告警链路要求绝不抛错，所以对任何输入都要有确定返回值。
 *
 * @param error 任意抛出的值
 * @returns 可直接拼进告警/失败原因的文本（不抛错、不返回空串）
 */
export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * 把任意错误归一成 `Error`，并在前面拼上业务 fallback 文案。
 *
 * 跨端 YAML 导入导出都会用这个函数把 decode / 落库阶段的异常统一包装，
 * 这样调用方拿到的永远是带上下文提示的 Error，不用各自再判一次类型。
 */
export function normalizeYamlError(error: unknown, fallback: string): Error {
    if (error instanceof Error) {
        return new Error(`${fallback}：${error.message}`);
    }
    return new Error(fallback);
}

/**
 * 归一化智能排序规则 YAML 导入的错误，供两端 app 通道的 `catch` 直接 `throw`。
 *
 * - 存储/事务类故障（{@link TdbcError}）**原样返回**：`importRules` 整体包
 *   一条事务，中途失败即回滚；套上「YAML 无效」前缀会把 DB 故障误报成用户格式错误。
 * - 其余（YAML 语法错 / schema 违规）照旧套 {@link SMART_SORT_IMPORT_YAML_INVALID_LABEL} 前缀。
 *
 * @remarks 这段「存储/事务类故障原样上抛、其余套『YAML 无效』前缀」的判据，
 *   此前在 desktop（`src/main/services/smart-sort-rule-yaml.service.ts`）与
 *   mobile（`src/services/smart-sort-rule-yaml.service.ts`）**各抄了一份字面量三元**。
 *   两份都写 ⇒ 两份都会漂：任一端被改坏，另一端照样绿，而旧测试
 *   （`test/common/storage-failure-bypass.test.ts`）只**重演**这段三元、断言两个
 *   纯函数各自的行为，压根没守接线——把任一端 app 的 `if (error instanceof TdbcError) throw error;`
 *   删掉，那条测试照样全绿。
 *
 *   收敛到本函数后，两端 app 只剩一次调用，`TdbcError` 的判据与
 *   `normalizeYamlError` 的前缀**只有这一处**；测试也直接测它 ⇒ 测的就是真正
 *   被两端执行的那段逻辑，接线被删会立刻红。
 *
 *   ⚠️ 判据按**反转**写（只让存储类绕过），不做正向白名单列举：YAML 语法错
 *   （`parseText`）与 schema 校验错（`decode`）抛的都是 `ConfigDecodeError`，
 *   而它未在任何 `packages/core/src/public/*` 导出 ⇒ app 侧无法 import，按业务
 *   错误正向列举会把最常见的失败路径整类漏判成 DB 类，「YAML 无效」标签反而从
 *   主路径上消失（功能回归）。
 *
 *   ⚠️ 若驱动把异常包了一层（不再 `TdbcError` 派生），本判据会失效 ⇒ 调用方的
 *   验收必须带一条「注入真实 DB 故障后 message 不含前缀」的断言兜底。
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
