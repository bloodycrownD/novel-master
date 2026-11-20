import assert from "node:assert/strict";
import type { AppError } from "../../src/errors/app-error.js";
import type { Result } from "../../src/errors/either.js";

/**
 * 测试边界解包：`Ok` 返回 value，`Err` 直接 `throw r.error`（等价边界写法
 * `if (!r.ok) throw r.error`）。非 Result 形状的值原样透传——部分 fixture 调的
 * 方法仍走裸值通道，tolerant 形态让同一 helper 覆盖两种调用点。
 */
export function unwrap<T>(r: Result<T, AppError> | T): T {
  if (r !== null && typeof r === "object" && "ok" in r) {
    const result = r as Result<T, AppError>;
    if (!result.ok) throw result.error;
    return result.value;
  }
  return r;
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
