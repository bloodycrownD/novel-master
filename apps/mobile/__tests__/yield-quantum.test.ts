/**
 * T-Y1 — 量子让步原语：
 * - 窗内连调不 await：距上次让步 <intervalMs 时同步直通，不安排定时器；
 * - 跨窗 setTimeout(0)：距上次让步 >=intervalMs 时恰好安排一次 0ms 定时器，
 *   让步完成后窗口以让步时刻重置；
 * - 构造参数注入：intervalMs=0 恒跨窗（时间不前进也逐次让步）、
 *   极大 intervalMs 恒直通（等价使用方注入同步 resolve mock 的场景）。
 */
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {createQuantumYield} from '@/services/yield-quantum';

const BASE = 1_000_000;

describe('yield-quantum — T-Y1', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('窗内连调不 await：Date.now 前进 <16ms 时同步直通（不安排定时器）', async () => {
    const yieldToEventLoop = createQuantumYield();
    // 构造时刻即首个窗口起点：+10ms 仍在窗内
    jest.setSystemTime(BASE + 10);
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);

    // 紧接再调（+15ms，距构造仍 <16ms），继续直通
    jest.setSystemTime(BASE + 15);
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('跨窗 setTimeout(0) 让步：距上次让步 >=16ms 时安排一次 0ms 定时器', async () => {
    const yieldToEventLoop = createQuantumYield();
    jest.setSystemTime(BASE + 16); // 距构造 16ms → 跨窗
    let resolved = false;
    const pending = yieldToEventLoop().then(() => {
      resolved = true;
    });
    // 恰好一个 setTimeout(0)，且宏任务清空前不 resolve
    expect(jest.getTimerCount()).toBe(1);
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(0);
    await pending;
    expect(resolved).toBe(true);

    // 让步后窗口以让步时刻重置：+15ms 内的后续调用直通
    jest.setSystemTime(BASE + 16 + 15);
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('intervalMs=0 注入：时间不前进也逐次跨窗、每次调用都让步', async () => {
    const yieldToEventLoop = createQuantumYield(0);
    const first = yieldToEventLoop();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(0);
    await first;

    // 第二次调用：Date.now 未前进，0 >= 0 仍成立 → 再次让步
    const second = yieldToEventLoop();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(0);
    await second;
  });

  it('极大 intervalMs 注入：任意推进时间都同步直通（等价注入同步 resolve mock）', async () => {
    const yieldToEventLoop = createQuantumYield(Number.MAX_SAFE_INTEGER);
    jest.setSystemTime(BASE + 1_000_000);
    for (let i = 0; i < 3; i++) {
      await expect(yieldToEventLoop()).resolves.toBeUndefined();
    }
    expect(jest.getTimerCount()).toBe(0);
  });
});
