/**
 * 流式看门狗原语级测试（spec llm-stream-timeout T-T1/T-T2/T-T3）：
 * 双 deadline 触发、慢节奏零误杀、dispose 无泄漏。fake timers 直测。
 *
 * @module test/infra/llm-protocol/stream-watchdog
 */

import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  createStreamWatchdog,
  FIRST_CHUNK_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamWatchdogPhase,
} from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";

// 注意：必须无参全量 enable——本 Node 版本的 apis 选项不支持单独指定
// "clearTimeout"，而只 mock setTimeout 会让 clearTimeout 仍是真实实现，
// mock 时钟里的定时器清不掉，dispose/撤销断言会失真。
const enableMockTimers = (): void => {
  mock.timers.enable();
};

afterEach(() => {
  mock.timers.reset();
});

describe("stream-watchdog 原语", () => {
  it("T-T1: 首字超时——firstChunkTimeoutMs 内无 noteActivity 则回调 first-chunk", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      onTimeout: (phase) => phases.push(phase),
    });

    // 阈值前一刻不触发
    mock.timers.tick(FIRST_CHUNK_TIMEOUT_MS - 1);
    assert.equal(phases.length, 0);

    // 到点触发 first-chunk
    mock.timers.tick(1);
    assert.deepEqual(phases, ["first-chunk"]);

    watchdog.dispose();
  });

  it("T-T2: 空闲超时——有活动后首字阶段撤销，静默 idleTimeoutMs 回调 idle", () => {
    enableMockTimers();
    // 撤销验证需 first-chunk 阈值 < idle 阈值才能区分两个 deadline，故用自定义值
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      firstChunkTimeoutMs: 1_000,
      idleTimeoutMs: 5_000,
      onTimeout: (phase) => phases.push(phase),
    });

    // 首个数据到达：首字阶段撤销，空闲 deadline 开始计时
    watchdog.noteActivity();
    mock.timers.tick(1_500);
    assert.equal(phases.length, 0, "首字阶段已被活动撤销，不应触发 first-chunk");

    // 静默到 idle 阈值前一刻不触发，到点触发 idle
    mock.timers.tick(5_000 - 1_500 - 1);
    assert.equal(phases.length, 0);
    mock.timers.tick(1);
    assert.deepEqual(phases, ["idle"]);

    watchdog.dispose();
  });

  it("T-T2: 默认阈值——首活动后静默 STREAM_IDLE_TIMEOUT_MS 触发 idle", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      onTimeout: (phase) => phases.push(phase),
    });

    watchdog.noteActivity();
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS - 1);
    assert.equal(phases.length, 0);
    mock.timers.tick(1);
    assert.deepEqual(phases, ["idle"]);

    watchdog.dispose();
  });

  it("T-T2: chunk 持续到达（间隔小于 idleTimeoutMs）长流不触发任何超时", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      onTimeout: (phase) => phases.push(phase),
    });

    watchdog.noteActivity();
    // 慢节奏：每 60s 一个 chunk（thinking 静默段口径，间隔 < 90s），持续 30 分钟
    for (let i = 0; i < 30; i++) {
      mock.timers.tick(60_000);
      watchdog.noteActivity();
    }
    mock.timers.tick(60_000);
    assert.deepEqual(phases, [], "慢节奏长流全程不应触发超时");

    watchdog.dispose();
  });

  it("T-T3: 零误杀——正常收尾 dispose 后定时器清空，长时间推进不再触发回调", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      onTimeout: (phase) => phases.push(phase),
    });

    watchdog.noteActivity();
    watchdog.dispose();

    // dispose 后推进远超两个阈值的时长，回调不再触发（定时器已清空、无泄漏）
    mock.timers.tick(
      FIRST_CHUNK_TIMEOUT_MS + STREAM_IDLE_TIMEOUT_MS + 60_000
    );
    assert.deepEqual(phases, []);
  });

  it("onTimeout 触发一次后进入终态：后续 noteActivity 不再重新武装", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      onTimeout: (phase) => phases.push(phase),
    });

    mock.timers.tick(FIRST_CHUNK_TIMEOUT_MS);
    assert.deepEqual(phases, ["first-chunk"]);

    // 超时触发后迟到的活动（abort 竞态窗口内的 onprogress）不得重启空闲计时
    watchdog.noteActivity();
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 3);
    assert.deepEqual(phases, ["first-chunk"], "终态后不应再次回调");

    watchdog.dispose();
  });

  it("自定义阈值覆盖默认值", () => {
    enableMockTimers();
    const phases: StreamWatchdogPhase[] = [];
    const watchdog = createStreamWatchdog({
      firstChunkTimeoutMs: 1_000,
      idleTimeoutMs: 500,
      onTimeout: (phase) => phases.push(phase),
    });

    mock.timers.tick(1_000);
    assert.deepEqual(phases, ["first-chunk"]);

    const idleWatchdog = createStreamWatchdog({
      firstChunkTimeoutMs: 1_000,
      idleTimeoutMs: 500,
      onTimeout: (phase) => phases.push(phase),
    });
    idleWatchdog.noteActivity();
    mock.timers.tick(500);
    assert.deepEqual(phases, ["first-chunk", "idle"]);

    idleWatchdog.dispose();
    watchdog.dispose();
  });
});
