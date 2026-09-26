/**
 * 流式看门狗原语级测试（spec llm-stream-timeout 回炉版 T-D1/T-D2）：
 * idle-only 触发、首字阶段无定时器（缓冲型模型零误杀）、慢节奏零误杀、
 * dispose 无泄漏。fake timers 直测。
 *
 * @module test/infra/llm-protocol/stream-watchdog
 */

import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  createStreamWatchdog,
  STREAM_IDLE_TIMEOUT_MS,
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

describe("stream-watchdog 原语（回炉版：仅 idle）", () => {
  it("T-D1: 首字阶段无任何定时器——活动前长时间推进不触发（缓冲型模型零误杀）", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      onTimeout: () => {
        fired += 1;
      },
    });

    // 无任何 noteActivity：推进远超 idle 阈值也不触发——首字不设自动超时
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 10);
    assert.equal(fired, 0, "首字阶段不应有任何 deadline");

    watchdog.dispose();
  });

  it("T-D1: 空闲超时——首活动后静默 idleTimeoutMs 触发一次", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      onTimeout: () => {
        fired += 1;
      },
    });

    watchdog.noteActivity();
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS - 1);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);

    watchdog.dispose();
  });

  it("T-D1: chunk 持续到达（间隔小于 idleTimeoutMs）长流不触发", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      onTimeout: () => {
        fired += 1;
      },
    });

    watchdog.noteActivity();
    // 慢节奏：每 20s 一个 chunk（间隔 < 30s 阈值），持续 10 分钟
    for (let i = 0; i < 30; i++) {
      mock.timers.tick(20_000);
      watchdog.noteActivity();
    }
    mock.timers.tick(20_000);
    assert.equal(fired, 0, "慢节奏长流全程不应触发超时");

    watchdog.dispose();
  });

  it("T-D2: 正常收尾 dispose 后定时器清空，长时间推进不再触发回调", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      onTimeout: () => {
        fired += 1;
      },
    });

    watchdog.noteActivity();
    watchdog.dispose();

    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 3);
    assert.equal(fired, 0);
  });

  it("T-D2: onTimeout 触发一次后进入终态：后续 noteActivity 不再重新武装", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      onTimeout: () => {
        fired += 1;
      },
    });

    watchdog.noteActivity();
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);
    assert.equal(fired, 1);

    // 超时触发后迟到的活动（abort 竞态窗口内的 onprogress）不得重启空闲计时
    watchdog.noteActivity();
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 3);
    assert.equal(fired, 1, "终态后不应再次回调");

    watchdog.dispose();
  });

  it("T-D2: 自定义阈值覆盖默认值", () => {
    enableMockTimers();
    let fired = 0;
    const watchdog = createStreamWatchdog({
      idleTimeoutMs: 500,
      onTimeout: () => {
        fired += 1;
      },
    });

    watchdog.noteActivity();
    mock.timers.tick(499);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);

    watchdog.dispose();
  });
});
