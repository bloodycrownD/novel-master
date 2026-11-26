/**
 * 不变量断言：条件为假说明代码写错（不变量破坏），不是用户可触发的失败。
 *
 * 这类失败保留 throw 通道（与业务失败的 Result 返回值通道分开）：断言失败意味着
 * 程序自身装配/穷尽分支出错，静默返回值只会掩盖根因。
 *
 * @module common/assert
 */

export class AssertionError extends Error {
    constructor(message: string) { super(`[invariant] ${message}`); this.name = "AssertionError"; }
}

/** cond 为假说明代码写错（不变量破坏），不是用户可触发的失败。 */
// nm-style: keep-bare: 断言原语(skill 5.3 例外)
export function assert(cond: unknown, message: string): asserts cond {
    // nm-throw: keep — 不变量破坏（代码写错才可达），按总纲走 assert/AssertionError，不占产品码。
    if (!cond) throw new AssertionError(message);
}
