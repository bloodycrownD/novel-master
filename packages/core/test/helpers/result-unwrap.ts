import assert from "node:assert/strict";
import type { AppError } from "../../src/errors/app-error.js";
import type { Result } from "../../src/errors/either.js";
import type { Outcome } from "../../src/errors/outcome.js";

/**
 * 测试边界解包：`Ok` 返回 value，`Err` 直接 `throw r.error`（等价边界写法
 * `if (!r.ok) throw r.error`）。`Outcome` 形状（fork/copy 等四分支契约）同样
 * 解包：completed → value，failed → throw error，中断分支 → assert.fail
 * （测试里预期取消应显式断言 Outcome 形状，不借 unwrap）。非 Result/Outcome
 * 形状的值原样透传——部分 fixture 调的方法仍走裸值通道，tolerant 形态让
 * 同一 helper 覆盖多种调用点。
 */
export function unwrap<T>(r: Result<T, AppError> | Outcome<T> | T): T {
  if (r !== null && typeof r === "object" && "ok" in r) {
    const result = r as Result<T, AppError>;
    if (!result.ok) throw result.error;
    return result.value;
  }
  if (r !== null && typeof r === "object" && "kind" in r) {
    const outcome = r as Outcome<T>;
    if (outcome.kind === "completed") return outcome.value;
    if (outcome.kind === "failed") throw outcome.error;
    assert.fail(`unwrap 遇到中断分支 ${outcome.kind}：预期取消请显式断言 Outcome 形状`);
  }
  return r;
}

/** 取 Err 载荷（配合 key/cause 断言）；Ok 或非 Result 形状即断言失败（error-matrix-final R1 起高频）。 */
export function unwrapErr<T, E>(r: Result<T, E> | T): E {
  if (r !== null && typeof r === "object" && "ok" in r) {
    const result = r as Result<T, E>;
    assert.ok(!result.ok, `预期 Err 分支，实际 ${result.ok ? "Ok" : ""}`);
    if (!result.ok) return result.error;
  }
  return assert.fail("预期 Err 分支，实际非 Result 形状");
}

/**
 * 旧 `assert.rejects` 的 Result 版（同形替换用）：域方法不再 throw 后，
 * 失败走 `Result.err`——取 Err 载荷交给断言回调。call 接 promise 或 thunk。
 */
export async function rejectsErr<T, E>(call: Promise<Result<T, E>> | (() => Promise<Result<T, E>>), onError?: (error: E) => unknown): Promise<void> {
  const result = await (typeof call === "function" ? call() : call);
  assert.ok(!result.ok, "预期 Err 分支（方法已改返回 Result，不再 throw）");
  if (!result.ok) void onError?.(result.error);
}
