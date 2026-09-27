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
 * 真实 sleep：只用于 T-B1 / T-B2 —— 这两条只 mock setInterval（Date 走真实
 * 时钟），靠 sleep 推进闸门时钟（lastFlushAt 口径），同时保持「interval
 * 冻结」的模拟后台语义（若改成 mock tick 会顺带触发 interval，失去意义）。
 */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("sse-chunk-emitter", () => {
  it("U-01: append batches into one onChunk per tick", () => {
    // 连 Date 一起 mock：`lastFlushAt` 初始化为 Date.now()，真实时钟下
    // 「创建到首个 append < 32ms」在 GC 停顿 / CI 高负载下会被打破而假失败。
    mock.timers.enable({ apis: ["setInterval", "Date"] });

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
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    emitter.append("leftover");
    const tail = emitter.flush();
    assert.equal(tail, "leftover");
    assert.equal(chunks.length, 0);

    // flush 已进入终态：既不进缓冲、也不投递。
    emitter.append("ignored");
    assert.equal(emitter.bufferedLength(), 0);
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

  it("M1-a: dispose 之后 append 为 no-op（闸门已开也不投递）", () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    // 先过闸，确保下面的「不投递」不是因为闸门关闭，而是终态守卫生效。
    mock.timers.tick(32);
    emitter.append("before-dispose");
    assert.equal(chunks.length, 1);

    emitter.dispose();
    emitter.append("after-dispose");
    assert.equal(emitter.bufferedLength(), 0);
    assert.equal(chunks.length, 1);

    // 终态后 tick 也不会把任何东西送出去。
    mock.timers.tick(64);
    assert.deepEqual(chunks, ["before-dispose"]);
  });

  it("M1-b: flush 之后 append 为 no-op（闸门已开也不投递）", () => {
    mock.timers.enable({ apis: ["setInterval", "Date"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    mock.timers.tick(32);
    emitter.append("before-flush");
    assert.equal(chunks.length, 1);

    // flush 时缓冲已空（被过闸 append 同步投递掉了），返回空串。
    assert.equal(emitter.flush(), "");

    emitter.append("after-flush");
    assert.equal(emitter.bufferedLength(), 0);
    assert.equal(chunks.length, 1);

    mock.timers.tick(64);
    assert.deepEqual(chunks, ["before-flush"]);
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
