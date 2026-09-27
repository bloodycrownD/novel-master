import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  createSseChunkEmitter,
  DEFAULT_TICK_MS,
} from "../../../src/infra/llm-protocol/logic/sse-chunk-emitter.js";

afterEach(() => {
  mock.timers.reset();
});

/**
 * 真实 sleep：mock.timers 只 mock setInterval（setTimeout 走真实定时器），
 * Date 也是真实时钟——sleep 推进的就是闸门时钟（lastFlushAt 口径）。
 */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("sse-chunk-emitter", () => {
  it("U-01: append batches into one onChunk per tick", () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    emitter.append("a");
    emitter.append("b");
    emitter.append("c");
    assert.equal(chunks.length, 0);

    mock.timers.tick(32);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "abc");

    emitter.dispose();
  });

  it("U-02: flush returns tail and stops ticks; dispose prevents further emit", () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    emitter.append("leftover");
    const tail = emitter.flush();
    assert.equal(tail, "leftover");
    assert.equal(chunks.length, 0);

    emitter.append("ignored");
    mock.timers.tick(32);
    assert.equal(chunks.length, 0);

    const emitter2 = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: DEFAULT_TICK_MS,
    });
    emitter2.append("x");
    emitter2.dispose();
    mock.timers.tick(DEFAULT_TICK_MS);
    assert.equal(chunks.filter((c) => c === "x").length, 0);
  });

  it("T-B1: interval 冻结（不 tick）下 append 驱动 flush，数据持续投递", async () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    // 前置构造：lastFlushAt 初始化为创建时刻，须先过开闸窗口（真实
    // sleep >32ms，Date 真实时钟）——跳过则首个 append 仍在窗口内、走
    // 缓冲，测不到目标行为。
    await sleep(45);

    // 模拟后台：interval 停摆（全程不 tick），onprogress 数据照常到达。
    // 过闸的 append 立即同步 flush。
    emitter.append("data-1");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "data-1");

    // 窗口内的后续 append 进缓冲（闸门防事件风暴），零投递。
    emitter.append("data-2");
    assert.equal(chunks.length, 1);

    // 再次过窗后，append 再次驱动 flush，缓冲与新数据合并投递。
    await sleep(45);
    emitter.append("data-3");
    assert.deepEqual(chunks, ["data-1", "data-2data-3"]);

    emitter.dispose();
  });

  it("T-B2: 32ms 窗口内多次 append 至多一次同步 flush，窗口过后下次 append 再 flush", async () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    // 过开闸窗口后，首个 append 立即同步 flush。
    await sleep(45);
    emitter.append("a");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "a");

    // 同一窗口内的后续 append：零投递、进缓冲（U-01 语义在闸门扩展下保持）。
    emitter.append("b");
    emitter.append("c");
    assert.equal(chunks.length, 1);

    // 窗口过后，下次 append 再 flush，窗口内积压的缓冲合并投递。
    await sleep(45);
    emitter.append("d");
    assert.deepEqual(chunks, ["a", "bcd"]);

    emitter.dispose();
  });
});
