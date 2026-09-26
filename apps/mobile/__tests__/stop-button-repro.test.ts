/**
 * 停止按钮 P0 防回归（传输链集成）：mock-dead 挂死 + abort 传导。
 *
 * 链路（与真机一致）：AbortController.abort → postSse runNative 组合
 * controller → 真 wrapper（createNativeSseTransportFromBridge + mock bridge）
 * → sseAbort。挂死模拟：sseConnect 后不注入任何事件（等价 mock-dead 首字
 * 未达）。断言：连接被客户端主动中止（sseAbort 到达）+ postSse 以
 * AbortError 形态 reject（run 收敛而非悬死）。
 *
 * 与 llm-sse-native-bridge-interop.test.ts 互补：那边锁定 bridge 方法
 * 完整性（lazy interop 形态），这边锁定 core postSse 公共层到 wrapper 的
 * abort 传导全链。
 */

import {describe, expect, it, jest } from '@jest/globals';

jest.mock('react-native', () => ({
  Platform: {OS: 'test'},
  NativeModules: {},
  NativeEventEmitter: class {},
}));

import {postSse, registerSseTransport} from '../../../packages/core/dist/infra/llm-protocol/logic/llm-sse-transport.js';
import {createNativeSseTransportFromBridge} from '@novel-master/llm-sse-native';

interface Recorded {
  connects: string[];
  aborts: string[];
}

function makeMockBridge(recorded: Recorded) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    bridge: {
      sseConnect(requestId: string) {
        recorded.connects.push(requestId);
        // 挂死：不注入任何事件
      },
      sseAbort(requestId: string) {
        recorded.aborts.push(requestId);
      },
      request() {
        return Promise.reject(new Error('unused'));
      },
      events: {
        addListener(name: string, listener: (e: unknown) => void) {
          let set = listeners.get(name);
          if (set == null) {
            set = new Set();
            listeners.set(name, set);
          }
          set.add(listener);
          return () => {
            set?.delete(listener);
          };
        },
      },
    },
  };
}

describe('stop-button 复现：native 分支挂死 + abort 传导', () => {
  it('挂死中 abort → bridge.sseAbort 被调 + postSse reject AbortError', async () => {
    const recorded: Recorded = {connects: [], aborts: []};
    const {bridge} = makeMockBridge(recorded);
    registerSseTransport(createNativeSseTransportFromBridge(bridge as never));

    const controller = new AbortController();
    let rejection: unknown;
    const p = postSse(
      'http://mock-dead/chat/completions',
      {method: 'POST', headers: {}, body: '{}'},
      () => undefined,
      undefined,
      {signal: controller.signal},
    ).catch((e: unknown) => {
      rejection = e;
      return undefined;
    });

    // 微任务冲一轮：sseConnect 应已到达（Promise executor 同步跑到 sseConnect）
    await Promise.resolve();
    await Promise.resolve();
    expect(recorded.connects).toHaveLength(1);

    // tap 终止：等价 stopRun → registry.abort → controller.abort()
    controller.abort();

    // 断言一：连接被客户端主动关闭（sseAbort 到达 native 侧）
    expect(recorded.aborts).toEqual(recorded.connects);
    // 断言二：postSse 以 AbortError 形态 reject（run 收敛而非悬死）
    await p;
    expect((rejection as {name?: string})?.name).toBe('AbortError');
  });
});
