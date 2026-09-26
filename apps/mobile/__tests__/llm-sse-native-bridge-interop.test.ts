/**
 * stop-button P0 防回归：bridgeless lazy interop 下 bridge 方法完整性。
 *
 * 根因（2026-09-25 实锤）：RN bridgeless 的 `NativeModules.X` 返回 lazy
 * jsRepresentation——初始为空对象，方法挂 HostObject 原型、首次属性访问才
 * 实体化为 own property（RN TurboModuleBinding.getModule）。旧实现
 * `{...nativeModule, events}` 只枚举 own property：isNativeSseAvailable 只
 * 访问过 sseConnect/request，sseAbort 从未被 get → spread 产物缺 sseAbort
 * → 终止链 `bridge.sseAbort(requestId)` 抛 "undefined is not a function"、
 * 连接不断、run 悬死（挂死只能等 30s 读超时收敛）。
 *
 * 本测试用「方法全在原型、own keys 为空」的对象精确模拟该 interop 形态，
 * 断言修复后 transport 的 abort 语义在真实 wrapper 全链上成立。
 */

import {describe, expect, it, jest} from '@jest/globals';

jest.mock('react-native', () => {
  // 原型上放三个方法（模拟 TurboModule HostObject 原型查找）；Proxy 的 get
  // trap 把访问过的属性写回本体缓存——精确复刻 RN jsRepresentation 的
  // 「首次属性访问实体化为 own property」语义。Object.keys() 初始为 []，
  // 与真机 BRIDGEKEYS 实测一致（stop-button P0 取证构建）。
  const proto = {
    sseConnect: jest.fn(),
    sseAbort: jest.fn(),
    request: jest.fn(() => Promise.reject(new Error('unused'))),
  };
  const lazyModule = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in proto) {
        const value = (proto as Record<string, unknown>)[prop];
        target[prop] = value; // 实体化缓存（RN interop 同款）
        return value;
      }
      return undefined;
    },
  });
  return {
    Platform: {OS: 'android'},
    NativeModules: {LlmSseNative: lazyModule},
    NativeEventEmitter: class {
      addListener() {
        return {remove: () => undefined};
      }
    },
  };
});

import {NativeModules, Platform} from 'react-native';
import {
  createNativeSseTransport,
  isNativeSseAvailable,
  resetNativeSseTransportForTests,
} from '@novel-master/llm-sse-native/native';

describe('stop-button P0 防回归：lazy interop bridge 方法完整性', () => {
  it('模拟环境自检：own keys 为空但原型方法可访问（interop 形态）', () => {
    expect(Platform.OS).toBe('android');
    const nm = NativeModules.LlmSseNative as unknown as Record<string, unknown>;
    expect(Object.keys(nm)).toEqual([]);
    expect(typeof nm.sseAbort).toBe('function');
  });

  it('挂起流中 abort → 原型上的 sseAbort 被调用 + postSse 形态 reject', async () => {
    resetNativeSseTransportForTests();
    expect(isNativeSseAvailable()).toBe(true);

    const nm = NativeModules.LlmSseNative as unknown as {
      sseConnect: jest.Mock;
      sseAbort: jest.Mock;
    };
    const transport = createNativeSseTransport();

    const controller = new AbortController();
    let rejection: unknown;
    const p = transport
      .post(
        'http://mock-dead/v1/chat/completions',
        {method: 'POST', headers: {}, body: '{}'},
        () => undefined,
        {signal: controller.signal},
      )
      .catch((e: unknown) => {
        rejection = e;
        return undefined;
      });

    await Promise.resolve();
    await Promise.resolve();
    expect(nm.sseConnect).toHaveBeenCalledTimes(1);
    // 修复前：这里炸 "bridge.sseAbort is not a function"（spread 丢方法）
    expect(() => controller.abort()).not.toThrow();

    expect(nm.sseAbort).toHaveBeenCalledTimes(1);
    expect(nm.sseAbort).toHaveBeenCalledWith(nm.sseConnect.mock.calls[0][0]);
    await p;
    expect((rejection as {name?: string})?.name).toBe('AbortError');
    resetNativeSseTransportForTests();
  });
});
