/**
 * T-S25：不变量断言走 `AssertionError`（不是 `AppError`）。
 *
 * 断言失败 = 程序自身写错，必须与业务失败（Result/AppError）通道分开；
 * `isAppError` 不得命中，边界（desktop `formatIpcError`）兜成
 * `INFRA_UNEXPECTED_ERROR`。四个 `*_INVARIANT_VIOLATION` 的退役由 `tsc` 层面
 * 保证（本文件不做运行时重复断言）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssertionError, assert as invariant, assertNever } from "@/common/assert.js";
import { AppError, isAppError } from "@/errors/app-error.js";

describe("common/assert（T-S25）", () => {
  it("assert(false, msg) 抛 AssertionError，带 [invariant] 前缀且不是 AppError", () => {
    let thrown: unknown;
    try {
      invariant(false, "装配不变量破坏");
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof AssertionError);
    assert.equal((thrown as Error).name, "AssertionError");
    assert.equal((thrown as Error).message, "[invariant] 装配不变量破坏");
    assert.equal(isAppError(thrown), false);
    assert.equal(thrown instanceof AppError, false);
  });

  it("assert 命中时正常返回（类型收窄为 asserts）", () => {
    let value: string | null = "x";
    invariant(value != null, "不应触发");
    // 编译期由 asserts 收窄；运行期只需确认没抛。
    assert.equal(value, "x");
  });

  it("assertNever 抛 AssertionError，并对 value 做 String 兜底", () => {
    let thrown: unknown;
    try {
      assertNever("unexpected-value" as never);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof AssertionError);
    assert.match((thrown as Error).message, /unreachable: unexpected-value/);

    let custom: unknown;
    try {
      assertNever("x" as never, "自定义穷尽提示");
    } catch (error) {
      custom = error;
    }
    assert.ok(custom instanceof AssertionError);
    assert.equal((custom as Error).message, "[invariant] 自定义穷尽提示");
  });
});
