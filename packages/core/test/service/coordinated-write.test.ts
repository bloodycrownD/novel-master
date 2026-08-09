/**
 * CoordinatedWrite 单元测试。
 *
 * 覆盖：
 * - 全部步骤成功（run 不抛、回滚不被调用）；
 * - 中间步骤失败（已执行步骤按逆序回滚、原始错误透传）；
 * - 首步失败（不触发任何回滚）；
 * - 末步失败（前面所有步骤都回滚）；
 * - 回滚阶段再次失败 → 抛 CoordinatedWriteRollbackError，根因挂 cause；
 * - 嵌套：内层 CoordinatedWrite 在外层某步 execute 里运行；
 * - register 校验 execute/rollback 必填。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CoordinatedWrite,
  CoordinatedWriteRollbackError,
  runCoordinatedWrite,
} from "@/service/coordinated-write.js";
import { createFailureInjector } from "../helpers/failure-injection.js";

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

    let caught: unknown;
    try {
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
        .register(
          injector.step("c", {
            onExecute: () => order.push("c:execute"),
            onRollback: () => order.push("c:rollback"),
          }),
        )
        .run();
    } catch (err) {
      caught = err;
    }

    // b 抛错前未记录 onExecute 副作用（注入器在调用 onExecute 之前抛）
    assert.deepEqual(order, ["a:execute", "a:rollback"]);
    assert.equal(injector.executeCount, 2);
    assert.deepEqual([...injector.executedSteps], ["a", "b"]);
    assert.deepEqual([...injector.rolledBackSteps], ["a"]);
    assert.ok(caught instanceof Error);
    assert.equal((caught as Error).message, "injected failure @ b (execute)");
  });

  it("首步失败时不触发任何回滚", async () => {
    const injector = createFailureInjector({ failAt: 1 });
    const order: string[] = [];

    await assert.rejects(
      () =>
        new CoordinatedWrite()
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
          .run(),
    );

    assert.deepEqual(order, []);
    assert.equal(injector.executeCount, 1);
    assert.equal(injector.rollbackCount, 0);
  });

  it("末步失败时前面所有步骤都回滚", async () => {
    const injector = createFailureInjector({ failAt: 3 });
    const order: string[] = [];

    await assert.rejects(
      () =>
        new CoordinatedWrite()
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
          .run(),
    );

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

  it("回滚阶段再次失败时抛 CoordinatedWriteRollbackError 且保留根因", async () => {
    const injector = createFailureInjector({
      failAt: 2,
      failOnRollbackAt: 1,
    });

    let caught: unknown;
    try {
      await new CoordinatedWrite()
        .register(injector.step("a"))
        .register(injector.step("b"))
        .register(injector.step("c"))
        .run();
    } catch (err) {
      caught = err;
    }
    const error = caught as CoordinatedWriteRollbackError;

    assert.ok(error instanceof CoordinatedWriteRollbackError);
    assert.ok(error.cause instanceof Error);
    assert.equal(
      (error.cause as Error).message,
      "injected failure @ b (execute)",
    );
    assert.equal(error.rollbackErrors.length, 1);
    assert.equal(error.rollbackErrors[0]?.step, "a");
    assert.ok(error.rollbackErrors[0]?.error instanceof Error);
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

    let caught: unknown;
    try {
      await new CoordinatedWrite()
        .register({
          name: "a",
          execute: async () => order.push("execute:a"),
          rollback: boom("a"),
        })
        .register({
          name: "b",
          execute: async () => order.push("execute:b"),
          rollback: boom("b"),
        })
        .register(
          injector.step("c", {
            onExecute: () => order.push("execute:c"),
          }),
        )
        .run();
    } catch (err) {
      caught = err;
    }
    const error = caught as CoordinatedWriteRollbackError;

    // 两步回滚都被触发，c 触发原始失败
    assert.deepEqual(order, [
      "execute:a",
      "execute:b",
      "rollback:b",
      "rollback:a",
    ]);
    assert.ok(error instanceof CoordinatedWriteRollbackError);
    // 聚合顺序按回滚触发顺序：先 b 后 a
    assert.deepEqual(
      error.rollbackErrors.map((e) => e.step),
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
        execute: async () => order.push("inner-a:execute"),
        rollback: async () => order.push("inner-a:rollback"),
      })
      .register({
        name: "inner-b",
        execute: async () => order.push("inner-b:execute"),
        rollback: async () => order.push("inner-b:rollback"),
      });

    // 内层正常跑完，外层第二步失败；外层回滚时，内层的步骤不在外层注册表里，
    // 所以不会被外层直接回滚——验证「嵌套作用域不互相串」。
    await assert.rejects(
      () =>
        new CoordinatedWrite()
          .register({
            name: "outer-a",
            execute: async () => {
              order.push("outer-a:execute");
              await inner.run();
            },
            rollback: async () => order.push("outer-a:rollback"),
          })
          .register({
            name: "outer-b",
            execute: async () => {
              order.push("outer-b:execute");
              throw new Error("outer-b:boom");
            },
            rollback: async () => order.push("outer-b:rollback"),
          })
          .run(),
    );

    assert.deepEqual(order, [
      "outer-a:execute",
      "inner-a:execute",
      "inner-b:execute",
      "outer-b:execute",
      "outer-a:rollback",
    ]);
  });

  it("runCoordinatedWrite 便捷函数等价于手动 register + run", async () => {
    const order: string[] = [];
    await runCoordinatedWrite([
      {
        name: "a",
        execute: async () => order.push("a"),
        rollback: async () => order.push("a:r"),
      },
      {
        name: "b",
        execute: async () => order.push("b"),
        rollback: async () => order.push("b:r"),
      },
    ]);
    assert.deepEqual(order, ["a", "b"]);
  });
});
