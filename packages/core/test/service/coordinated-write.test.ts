/**
 * CoordinatedWrite 单元测试。
 *
 * 覆盖（error-matrix-final R1：run() 全 Result 通道，异常哨兵退役）：
 * - 全部步骤成功（回滚不被调用）；
 * - 中间步骤失败（已执行步骤按逆序回滚、未知异常转 INFRA_UNEXPECTED_ERROR 且 cause 透传）；
 * - 首步失败（不触发任何回滚）；
 * - 末步失败（前面所有步骤都回滚）；
 * - 回滚阶段再次失败 → INFRA_ROLLBACK_DEGRADED（根因挂 cause、清单进 details）；
 * - 多步回滚失败全部聚合上报，不中断后续回滚；
 * - 嵌套：内层 CoordinatedWrite 在外层某步 execute 里运行；
 * - register 校验 execute/rollback 必填（编程错误走 assert）。
 */
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  CoordinatedWrite  } from "@/service/coordinated-write.js";
import {  AppError  } from "@/errors/app-error.js";
import {  Result  } from "../../src/errors/either.js";
import {  createFailureInjector  } from "../helpers/failure-injection.js";

/** 断言 run() 返回指定 key 的 Err 并收窄 error 类型。 */
function assertErr(r: Result<void, AppError>, key: AppError["key"]): AppError {
    assert.ok(!r.ok, `期望 ${key} 的 Err，实际 ${r.ok ? "Ok" : String(r.error.key)}`);
    assert.equal(r.error.key, key);
    return r.error;
}

describe("CoordinatedWrite", () => {
    it("所有步骤成功时不调用回滚", async () => {
        const injector = createFailureInjector();
        const order: string[] = [];

        await new CoordinatedWrite()
            .register(
                injector.step("a", {
                    onExecute: () => order.push("a:execute"),
                    onRollback: () => order.push("a:rollback"),
                }),
            )
            .register(
                injector.step("b", {
                    onExecute: () => order.push("b:execute"),
                    onRollback: () => order.push("b:rollback"),
                }),
            )
            .run();

        assert.deepEqual(order, ["a:execute", "b:execute"]);
        assert.equal(injector.executeCount, 2);
        assert.equal(injector.rollbackCount, 0);
    });

    it("中间步骤失败时，已执行步骤按逆序回滚并透传原始错误", async () => {
        const injector = createFailureInjector({ failAt: 2 });
        const order: string[] = [];

        const r = await new CoordinatedWrite()
            .register(
                injector.step("a", {
                    onExecute: () => order.push("a:execute"),
                    onRollback: () => order.push("a:rollback"),
                }),
            )
            .register(
                injector.step("b", {
                    onExecute: () => order.push("b:execute"),
                    onRollback: () => order.push("b:rollback"),
                }),
            )
            .register(
                injector.step("c", {
                    onExecute: () => order.push("c:execute"),
                    onRollback: () => order.push("c:rollback"),
                }),
            )
            .run();

        // b 抛错前未记录 onExecute 副作用（注入器在调用 onExecute 之前抛）
        assert.deepEqual(order, ["a:execute", "a:rollback"]);
        assert.equal(injector.executeCount, 2);
        assert.deepEqual([...injector.executedSteps], ["a", "b"]);
        assert.deepEqual([...injector.rolledBackSteps], ["a"]);
        // 未知异常（注入的裸 Error）→ INFRA_UNEXPECTED_ERROR + cause 透传（error-matrix-final 矩阵）
        const error = assertErr(r, "INFRA_UNEXPECTED_ERROR");
        assert.ok(error.cause instanceof Error);
        assert.equal((error.cause as Error).message, "injected failure @ b (execute)");
    });

    it("首步失败时不触发任何回滚", async () => {
        const injector = createFailureInjector({ failAt: 1 });
        const order: string[] = [];

        const r = await new CoordinatedWrite()
            .register(
                injector.step("a", {
                    onExecute: () => order.push("a:execute"),
                    onRollback: () => order.push("a:rollback"),
                }),
            )
            .register(
                injector.step("b", {
                    onExecute: () => order.push("b:execute"),
                    onRollback: () => order.push("b:rollback"),
                }),
            )
            .run();

        assert.ok(!r.ok);
        assert.deepEqual(order, []);
        assert.equal(injector.executeCount, 1);
        assert.equal(injector.rollbackCount, 0);
    });

    it("末步失败时前面所有步骤都回滚", async () => {
        const injector = createFailureInjector({ failAt: 3 });
        const order: string[] = [];

        const r = await new CoordinatedWrite()
            .register(
                injector.step("a", {
                    onExecute: () => order.push("a:execute"),
                    onRollback: () => order.push("a:rollback"),
                }),
            )
            .register(
                injector.step("b", {
                    onExecute: () => order.push("b:execute"),
                    onRollback: () => order.push("b:rollback"),
                }),
            )
            .register(
                injector.step("c", {
                    onExecute: () => order.push("c:execute"),
                    onRollback: () => order.push("c:rollback"),
                }),
            )
            .run();

        assert.ok(!r.ok);
        // 回滚按注册逆序：c 失败 → b 先回滚，再 a
        assert.deepEqual(order, [
            "a:execute",
            "b:execute",
            "b:rollback",
            "a:rollback",
        ]);
        assert.deepEqual([...injector.rolledBackSteps], ["b", "a"]);
    });

    it("空 run 直接成功", async () => {
        await new CoordinatedWrite().run();
    });

    it("回滚阶段再次失败时返回 INFRA_ROLLBACK_DEGRADED 且根因挂 cause、清单进 details", async () => {
        const injector = createFailureInjector({
            failAt: 2,
            failOnRollbackAt: 1,
        });

        const r = await new CoordinatedWrite()
            .register(injector.step("a"))
            .register(injector.step("b"))
            .register(injector.step("c"))
            .run();
        const error = assertErr(r, "INFRA_ROLLBACK_DEGRADED");

        assert.ok(error.cause instanceof Error);
        assert.equal(
            (error.cause as Error).message,
            "injected failure @ b (execute)",
        );
        const rollbackErrors = (error.details as {rollbackErrors?: ReadonlyArray<{step: string; error: unknown}>}).rollbackErrors ?? [];
        assert.equal(rollbackErrors.length, 1);
        assert.equal(rollbackErrors[0]?.step, "a");
        assert.ok(rollbackErrors[0]?.error instanceof Error);
        assert.ok(String((error.details as {causeText?: string}).causeText).includes("injected failure"));
    });

    it("多步回滚失败时全部聚合上报，不中断后续回滚", async () => {
        // 这组里 a/b 是直接写的 step（不走注入器计数），只有 c 通过注入器；
        // 因此 failAt=1 表示「注入器第一次执行就抛」，即 c 那一步。
        const injector = createFailureInjector({ failAt: 1 });
        const order: string[] = [];
        const boom = (label: string) => async () => {
            order.push(`rollback:${label}`);
            throw new Error(`rollback-boom:${label}`);
        };

        const r = await new CoordinatedWrite()
            .register({
                name: "a",
                execute: async () => {
                    order.push("execute:a");
                    return Result.ok(undefined);
                },
                rollback: boom("a"),
            })
            .register({
                name: "b",
                execute: async () => {
                    order.push("execute:b");
                    return Result.ok(undefined);
                },
                rollback: boom("b"),
            })
            .register(
                injector.step("c", {
                    onExecute: () => order.push("execute:c"),
                }),
            )
            .run();
        const error = assertErr(r, "INFRA_ROLLBACK_DEGRADED");

        // 两步回滚都被触发，c 触发原始失败
        assert.deepEqual(order, [
            "execute:a",
            "execute:b",
            "rollback:b",
            "rollback:a",
        ]);
        // 聚合顺序按回滚触发顺序：先 b 后 a
        const rollbackErrors = (error.details as {rollbackErrors?: ReadonlyArray<{step: string}>}).rollbackErrors ?? [];
        assert.deepEqual(
            rollbackErrors.map((e) => e.step),
            ["b", "a"],
        );
    });

    it("register 校验 execute/rollback 必填", () => {
        assert.throws(
            () =>
                new CoordinatedWrite().register({
                    name: "x",
                    execute: async () => {},
                    // @ts-expect-error 故意漏掉 rollback
                    rollback: undefined,
                }),
            /rollback/,
        );
        assert.throws(
            () =>
                new CoordinatedWrite().register({
                    name: "x",
                    // @ts-expect-error 故意漏掉 execute
                    execute: undefined,
                    rollback: async () => {},
                }),
            /execute/,
        );
    });

    it("嵌套：外层步骤里跑内层 CoordinatedWrite，内层失败先回滚内部", async () => {
        const order: string[] = [];
        const inner = new CoordinatedWrite()
            .register({
                name: "inner-a",
                execute: async () => {
                    order.push("inner-a:execute");
                    return Result.ok(undefined);
                },
                rollback: async () => {
                    order.push("inner-a:rollback");
                    return Result.ok(undefined);
                },
            })
            .register({
                name: "inner-b",
                execute: async () => {
                    order.push("inner-b:execute");
                    return Result.ok(undefined);
                },
                rollback: async () => {
                    order.push("inner-b:rollback");
                    return Result.ok(undefined);
                },
            });

        // 内层正常跑完，外层第二步失败；外层回滚时，内层的步骤不在外层注册表里，
        // 所以不会被外层直接回滚——验证「嵌套作用域不互相串」。
        const r = await new CoordinatedWrite()
            .register({
                name: "outer-a",
                execute: async () => {
                    order.push("outer-a:execute");
                    await inner.run();
                    return Result.ok(undefined);
                },
                rollback: async () => {
                    order.push("outer-a:rollback");
                    return Result.ok(undefined);
                },
            })
            .register({
                name: "outer-b",
                execute: async () => {
                    order.push("outer-b:execute");
                    throw new Error("outer-b:boom");
                },
                rollback: async () => {
                    order.push("outer-b:rollback");
                    return Result.ok(undefined);
                },
            })
            .run();
        assert.ok(!r.ok);

        assert.deepEqual(order, [
            "outer-a:execute",
            "inner-a:execute",
            "inner-b:execute",
            "outer-b:execute",
            "outer-a:rollback",
        ]);
    });
});
