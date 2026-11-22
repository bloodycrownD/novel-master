import assert from "node:assert/strict";
import type { Outcome } from "../../src/errors/outcome.js";

/**
 * 测试侧 Outcome 收窄：断言 `completed` 并返回 value。中断/替换/失败分支由
 * 各用例直判 `kind`（cancelled 不是错误，不能混进 Result 断言）。
 */
export function outcomeValue<T>(o: Outcome<T>): T {
    assert.equal(o.kind, "completed", "此用例只关心 completed 分支");
    return o.value;
}
