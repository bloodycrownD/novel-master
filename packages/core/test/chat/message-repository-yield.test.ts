/**
 * T-R2（rollback-large-jank Step 2）：repository 列表行解析分片让步。
 *
 * - 注入 yieldFn 后 >50 行的列表解析按片执行、片间出现让步点（受控 gate
 *   注入——约束口径：测试体系须构造注入，禁宏任务裸让步），结果与直通
 *   同步 map 逐条全等；
 * - ≤50 行（单片）零让步点；
 * - 缺省不传 yieldFn（desktop/cli 形态）直通路径行为不变。
 *
 * 让步次数口径：每片 ≤50 行、仅「后面还有行」的片间让步——n 行触发
 * floor((n-1)/50) 次让步（50 行整 = 0 次，51 行 = 1 次，120 行 = 2 次）。
 *
 * @module test/chat/message-repository-yield
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 受控让步：每次调用记一次数并挂起，由测试逐个放行。 */
function createGatedYield(): {
  yieldFn: () => Promise<void>;
  calls: () => number;
  /** 释放一个挂起的让步点；返回是否确有挂起者。 */
  releaseOne: () => boolean;
} {
  const pending: Array<() => void> = [];
  let count = 0;
  return {
    yieldFn: () =>
      new Promise<void>((resolve) => {
        count += 1;
        pending.push(resolve);
      }),
    calls: () => count,
    releaseOne: () => {
      const release = pending.shift();
      if (release == null) {
        return false;
      }
      release();
      return true;
    },
  };
}

/** 等待一个宏任务心跳：让微任务链先推进到（可能存在的）让步 gate。 */
function macroTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("message repository 行解析分片让步（T-R2）", () => {
  it("T-R2a: 120 行 listBySession 出现 2 个让步点，结果与直通逐条全等", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr2a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    for (let i = 0; i < 120; i++) {
      await ctx.messages.append(
        session.id,
        i % 2 === 0 ? "user" : "assistant",
        i % 2 === 0
          ? textBlocks(`消息 ${i}`)
          : { blocks: [{ type: "text", text: `回复 ${i}` }] },
      );
    }

    // 直通基准（desktop/cli 形态：不传 yieldFn）。
    const plain = new SqliteMessageRepository(ctx.conn);
    const baseline = await plain.listBySession(session.id);
    assert.equal(baseline.length, 120);

    const gate = createGatedYield();
    const repo = new SqliteMessageRepository(ctx.conn, gate.yieldFn);
    const pending = repo.listBySession(session.id);

    // 逐让步点验证：宏任务心跳等到下一个让步点挂起（此时结果必未完成
    //——解析仍停在片间 gate 上，让步真实生效而非瞬时同步返回），再放行。
    let settledEarly = false;
    void pending.then(() => {
      settledEarly = true;
    });
    for (let point = 1; point <= 2; point++) {
      for (let i = 0; i < 200 && gate.calls() < point; i++) {
        await macroTick();
      }
      assert.equal(
        gate.calls(),
        point,
        `120 行应出现第 ${point} 个片间让步点`,
      );
      await macroTick();
      assert.equal(
        settledEarly,
        false,
        `第 ${point} 个让步点未放行时 listBySession 不得完成`,
      );
      assert.ok(gate.releaseOne());
    }
    // 心跳排空后不得冒出第三个让步点（120 行 = 3 片 = 2 个片间让步）。
    await macroTick();
    await macroTick();
    assert.equal(gate.calls(), 2);

    const result = await pending;
    assert.deepEqual(result, baseline);
  });

  it("T-R2b: 50 行整单片零让步点；61 行 tail 出现 1 个让步点且结果等价", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr2b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    for (let i = 0; i < 50; i++) {
      await ctx.messages.append(
        session.id,
        "user",
        textBlocks(`行 ${i}`),
      );
    }

    // 计数型让步（不挂起）：验证单片零让步与跨片恰一次让步的次数口径。
    let yieldCount = 0;
    const repo = new SqliteMessageRepository(ctx.conn, async () => {
      yieldCount += 1;
    });

    const all = await repo.listBySession(session.id);
    assert.equal(all.length, 50);
    const tail = await repo.listBySessionTail(session.id, 51);
    assert.equal(tail.length, 50);
    // 50 行整 = 单片，两处列表均零让步点。
    assert.equal(yieldCount, 0);

    // 61 条时 tail（61 行）恰出现 1 个让步点，结果与直通逐条等价。
    for (let i = 50; i < 61; i++) {
      await ctx.messages.append(session.id, "user", textBlocks(`行 ${i}`));
    }
    const plain = new SqliteMessageRepository(ctx.conn);
    const tailBaseline = await plain.listBySessionTail(session.id, 61);
    const tailYielded = await repo.listBySessionTail(session.id, 61);
    assert.equal(yieldCount, 1);
    assert.deepEqual(tailYielded, tailBaseline);
  });

  it("T-R2c: 缺省不传 yieldFn——直通同步 map，desktop/cli 行为不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr2c-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    for (let i = 0; i < 60; i++) {
      await ctx.messages.append(session.id, "user", textBlocks(`行 ${i}`));
    }

    // desktop/cli 形态：构造缺省不传 yieldFn → mapRows 直通同步 map。
    // 60 行在直通下可正常返回且结果稳定（与注入路径的逐条等价由 T-R2a
    // deepEqual 兜底；全量回归由 T-R6 既有用例群承担）。
    const repo = new SqliteMessageRepository(ctx.conn);
    const first = await repo.listBySession(session.id);
    const second = await repo.listBySession(session.id);
    assert.equal(first.length, 60);
    assert.deepEqual(first, second);
  });
});
