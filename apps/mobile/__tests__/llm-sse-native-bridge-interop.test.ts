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

// 以 mock 开头的变量可被 hoisted jest.mock 工厂引用（jest 约定）；
// 外提是为了让「方法面残缺」用例能直接增删 proto 方法（见 2026-11-22 防回归用例）。
const mockProto: Record<string, unknown> = {
    sseConnect: jest.fn(),
    sseAbort: jest.fn(),
    request: jest.fn(() => Promise.reject(new Error('unused'))),
    requestAbort: jest.fn(),
};

jest.mock('react-native', () => {
    // 原型上放方法（模拟 TurboModule HostObject 原型查找）；Proxy 的 get
    // trap 把访问过的属性写回本体缓存——精确复刻 RN jsRepresentation 的
    // 「首次属性访问实体化为 own property」语义。Object.keys() 初始为 []，
    // 与真机 BRIDGEKEYS 实测一致（stop-button P0 取证构建）。
    // sseAbort 缺失会让流式 transport 被判不可用（回落 XHR）；requestAbort
    // 缺失自 2026-11-22 起只影响非流式 shim（其自行退化），不再绑死流式探测。
    const lazyModule = new Proxy({} as Record<string, unknown>, {
        get(target: Record<string, unknown>, prop: string | symbol) {
            if (typeof prop === 'string' && prop in mockProto) {
                const value = mockProto[prop];
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
import {NativeSse} from '@novel-master/llm-sse-native/native';

describe('stop-button P0 防回归：lazy interop bridge 方法完整性', () => {
    it('模拟环境自检：own keys 为空但原型方法可访问（interop 形态）', () => {
        expect(Platform.OS).toBe('android');
        const nm = NativeModules.LlmSseNative as unknown as Record<string, unknown>;
        expect(Object.keys(nm)).toEqual([]);
        expect(typeof nm.sseAbort).toBe('function');
        expect(typeof nm.requestAbort).toBe('function');
    });

    it('2026-11-22 防回归：requestAbort 缺失（旧 APK 三方法面）时流式 transport 仍可注册', () => {
        NativeSse.resetTransportForTests();
        const original = mockProto.requestAbort;
        delete mockProto.requestAbort;
        try {
            // 真机实锤形态：11-12 APK 方法面 sseConnect/sseAbort/request × 11-17+ JS。
            // 旧探测（四方法全测）在此 false → native 永不接管、流式全走 XHR 黑盒
            // （UTF-8 无声损坏根因链的入口）；新契约只测流式必需的 sseConnect/sseAbort。
            expect(NativeSse.isAvailable()).toBe(true);
            let registered = false;
            expect(NativeSse.registerWith(() => { registered = true; })).toBe(true);
            expect(registered).toBe(true);
        } finally {
            mockProto.requestAbort = original;
        }
    });

    it('挂起流中 abort → 原型上的 sseAbort 被调用 + postSse 形态 reject', async () => {
        NativeSse.resetTransportForTests();
        expect(NativeSse.isAvailable()).toBe(true);

        const nm = NativeModules.LlmSseNative as unknown as {
            sseConnect: jest.Mock;
            sseAbort: jest.Mock;
        };
        const transport = NativeSse.createTransport();

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
        NativeSse.resetTransportForTests();
    });
});
