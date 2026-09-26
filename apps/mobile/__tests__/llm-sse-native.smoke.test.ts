/**
 * llm-sse-native 冒烟（集成形态从简——spec §2：包内 tsx 直测已覆盖 wrapper
 * 全量逻辑，这里只验证 RN Jest 环境下 `@novel-master/llm-sse-native/native`
 * 经 moduleNameMapper → dist 解析可加载、native 缺位时安全降级不抛错）。
 */

import {
  createNativeSseTransportFromBridge,
  NativeSseTransportError,
  flattenRequestHeaders,
} from '@novel-master/llm-sse-native';
import {
  isNativeSseAvailable,
  registerNativeSseTransportWith,
} from '@novel-master/llm-sse-native/native';

describe('llm-sse-native smoke (RN jest environment)', () => {
  it('native 入口在 Jest（无 LlmSseNative 模块）下安全加载且不可用', () => {
    // RN jest-preset 的 NativeModules 是空 mock：LlmSseNative 未注册 → 不可用
    expect(isNativeSseAvailable()).toBe(false);
  });

  it('native 不可用时 registerNativeSseTransportWith 返回 false（装配点据此回落 XHR）', () => {
    const register = jest.fn();
    expect(registerNativeSseTransportWith(register)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('环境无关入口可正常使用纯逻辑（dist 解析健康）', () => {
    expect(flattenRequestHeaders({A: '1'})).toEqual(['A', '1']);
    expect(NativeSseTransportError).toBeDefined();
    expect(typeof createNativeSseTransportFromBridge).toBe('function');
  });
});
