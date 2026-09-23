/**
 * {@link OpSqliteConnection} 量子让步的后台感知：注入 isBackground 后，
 * 后台跳过休眠让步、语句连续执行；false/未注入时让步行为与现状一致。
 *
 * @module tdbc-driver-op-sqlite/test/connection-yield-background
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpSqliteAdapter, OpSqliteResult } from "../src/adapter.js";
import { OpSqliteDriver } from "../src/driver.js";

/**
 * 带 executeSync 的最小 fake adapter：量子让步只发生在事务内的
 * executeSync 分流路径（无 executeSync 的 mock 会落回 async 路径，
 * 测不到让步点）。
 */
function makeSyncFakeAdapter(): OpSqliteAdapter {
  return {
    async open() {},
    async close() {},
    async execute(): Promise<OpSqliteResult> {
      return {};
    },
    executeSync(): OpSqliteResult {
      return {};
    },
  };
}

/** 真实 sleep（毫秒），用于在事务内跨过 16ms 量子窗口制造让步时机。 */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 拦截全局 setTimeout 计数让步调用（第二参为 0 的调用，转调原实现
 * 不破坏真实时序），try/finally 恢复。
 */
function installYieldCounter(): { calls: () => number; restore: () => void } {
  const orig = globalThis.setTimeout;
  let yields = 0;
  globalThis.setTimeout = ((
    cb: TimerHandler,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === 0) {
      yields += 1;
    }
    return orig(cb, ms, ...args);
  }) as typeof setTimeout;
  return {
    calls: () => yields,
    restore: () => {
      globalThis.setTimeout = orig;
    },
  };
}

/** 事务内跨量子窗口执行两条语句，返回按序完成的标记。 */
async function runTwoStatementTx(
  isBackground?: () => boolean,
): Promise<string[]> {
  const driver = new OpSqliteDriver(makeSyncFakeAdapter(), isBackground);
  const conn = await driver.open({ filename: ":memory:" });
  const executed: string[] = [];
  await conn.transaction(async (tx) => {
    await sleep(20); // 跨过 16ms 量子，制造「本该让步」的时机
    await tx.execute("INSERT INTO t VALUES (1)");
    executed.push("s1");
    await sleep(20);
    await tx.execute("INSERT INTO t VALUES (2)");
    executed.push("s2");
  });
  await conn.close();
  return executed;
}

describe("T-B3: 量子让步后台跳过", () => {
  it("isBackground=true：事务内无 setTimeout 让步调用，语句连续执行", async () => {
    const counter = installYieldCounter();
    try {
      const executed = await runTwoStatementTx(() => true);
      assert.deepEqual(executed, ["s1", "s2"]);
      assert.equal(counter.calls(), 0);
    } finally {
      counter.restore();
    }
  });

  it("isBackground=false：让步行为与现状一致", async () => {
    const counter = installYieldCounter();
    try {
      const executed = await runTwoStatementTx(() => false);
      assert.deepEqual(executed, ["s1", "s2"]);
      assert.ok(counter.calls() >= 1, "前台事务应照旧触发量子让步");
    } finally {
      counter.restore();
    }
  });

  it("未注入 isBackground：默认行为与现状一致（照旧让步）", async () => {
    const counter = installYieldCounter();
    try {
      const executed = await runTwoStatementTx();
      assert.deepEqual(executed, ["s1", "s2"]);
      assert.ok(counter.calls() >= 1, "未注入时事务应照旧触发量子让步");
    } finally {
      counter.restore();
    }
  });
});
