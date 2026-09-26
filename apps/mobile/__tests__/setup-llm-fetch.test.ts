/**
 * T-N4 装配面（spec llm-stream-native §4 / 变更点 #4）：
 *
 * - `ensureLlmFetchConfigured` 生产/开发统一注册 shim（无条件
 *   `configureLlmFetch(shim)`），native 底座可用时非流式流量走 native request
 * - `__DEV__` 下组合顺序写死 logging 最外层包 shim（`createLoggingFetch(shim)`）；
 *   生产构建 logging 不参与
 * - runtime 初始化处注册 native transport：`registerNativeSseTransportWith(
 *   registerSseTransport)`，native 缺位返回 false 不炸启动
 * - native 缺位（iOS / Jest）时 shim 工厂回落 `globalThis.fetch`，装配仍成立
 */

const mockConfigureLlmFetch = jest.fn();
const mockCreateLoggingFetch = jest.fn();
const mockRegisterSseTransport = jest.fn();
const mockRegisterNativeSseTransportWith = jest.fn();

jest.mock('@novel-master/core/provider', () => ({
  configureLlmFetch: mockConfigureLlmFetch,
  createLoggingFetch: mockCreateLoggingFetch,
  registerSseTransport: mockRegisterSseTransport,
}));

jest.mock('@novel-master/llm-sse-native/native', () => ({
  registerNativeSseTransportWith: mockRegisterNativeSseTransportWith,
}));

// LlmSseNative 模块的可控占位：request 存在与否决定 shim 走 native 底座还是回落。
const nativeModuleState: {request?: unknown} = {};

jest.mock('react-native', () => ({
  NativeModules: {LlmSseNative: nativeModuleState},
}));

type SetupModule = typeof import('../src/runtime/setup-llm-fetch');

/** 按指定 __DEV__ 值隔离加载 setup-llm-fetch（模块级 configured 状态随之重置）。 */
function loadSetupModule(dev: boolean): SetupModule {
  (globalThis as {__DEV__?: boolean}).__DEV__ = dev;
  let mod: SetupModule | undefined;
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../src/runtime/setup-llm-fetch') as SetupModule;
  });
  return mod!;
}

/** 装一个能被 shim 调用的 native request mock（200 JSON 响应）。 */
function installNativeRequest(): jest.Mock {
  const request = jest.fn(async () => ({
    status: 200,
    contentType: 'application/json',
    body: '{"data":[]}',
  }));
  nativeModuleState.request = request;
  return request;
}

/** createLoggingFetch 的最小替身：返回带标记的透传包装，便于断言组合顺序。 */
function installLoggingMock(): void {
  mockCreateLoggingFetch.mockImplementation(
    (base: (input: unknown, init?: unknown) => unknown) => {
      const wrapped = (input: unknown, init?: unknown) =>
        base(input, init);
      return Object.assign(wrapped, {__isLoggingWrap: true});
    },
  );
}

describe('setup-llm-fetch 装配 (T-N4)', () => {
  const originalDev = (globalThis as {__DEV__?: boolean}).__DEV__;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterNativeSseTransportWith.mockReturnValue(true);
    installLoggingMock();
    installNativeRequest();
  });

  afterAll(() => {
    (globalThis as {__DEV__?: boolean}).__DEV__ = originalDev;
    globalThis.fetch = originalFetch;
    nativeModuleState.request = undefined;
  });

  it('__DEV__：logging 最外层包 shim——configureLlmFetch 收到 logging 包装，base 打到 native request', async () => {
    const {ensureLlmFetchConfigured} = loadSetupModule(true);
    ensureLlmFetchConfigured();

    expect(mockCreateLoggingFetch).toHaveBeenCalledTimes(1);
    const registered = mockConfigureLlmFetch.mock.calls[0]![0] as {
      __isLoggingWrap?: boolean;
      (input: unknown, init?: unknown): unknown;
    };
    expect(registered.__isLoggingWrap).toBe(true);

    // 组合顺序：外层是 logging 包装；它包住的 base 是 native 底座 shim——
    // 调用注册进来的 fn，流量最终打到 native request（logging 覆盖全部非流式）。
    const request = nativeModuleState.request as jest.Mock;
    await registered('https://api.example.com/v1/models', {method: 'GET'});
    expect(request).toHaveBeenCalledWith(
      'GET',
      'https://api.example.com/v1/models',
      [],
      null,
      expect.any(Number),
    );
  });

  it('生产（__DEV__=false）：无条件直接注册 shim，logging 不参与', async () => {
    const {ensureLlmFetchConfigured} = loadSetupModule(false);
    ensureLlmFetchConfigured();

    expect(mockCreateLoggingFetch).not.toHaveBeenCalled();
    expect(mockConfigureLlmFetch).toHaveBeenCalledTimes(1);
    const registered = mockConfigureLlmFetch.mock.calls[0]![0] as (
      input: unknown,
      init?: unknown,
    ) => unknown;

    const request = nativeModuleState.request as jest.Mock;
    await registered('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: '{"m":1}',
    });
    expect(request).toHaveBeenCalledWith(
      'POST',
      'https://api.example.com/v1/chat/completions',
      [],
      '{"m":1}',
      expect.any(Number),
    );
  });

  it('runtime 注册 native transport：registerNativeSseTransportWith 收到 core 的 registerSseTransport', () => {
    const {ensureLlmFetchConfigured} = loadSetupModule(true);
    ensureLlmFetchConfigured();

    expect(mockRegisterNativeSseTransportWith).toHaveBeenCalledTimes(1);
    expect(mockRegisterNativeSseTransportWith).toHaveBeenCalledWith(
      mockRegisterSseTransport,
    );
  });

  it('native transport 缺位（返回 false）时装配不炸，fetch 侧照常注册', () => {
    mockRegisterNativeSseTransportWith.mockReturnValue(false);
    const {ensureLlmFetchConfigured} = loadSetupModule(true);

    expect(() => ensureLlmFetchConfigured()).not.toThrow();
    expect(mockConfigureLlmFetch).toHaveBeenCalledTimes(1);
  });

  it('native request 底座缺位（iOS/Jest 形态）：回落 globalThis.fetch，装配仍成立', () => {
    nativeModuleState.request = undefined;
    const fetchMock = jest.fn(async () => ({status: 200, ok: true}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const {ensureLlmFetchConfigured} = loadSetupModule(false);
    ensureLlmFetchConfigured();

    expect(mockConfigureLlmFetch).toHaveBeenCalledTimes(1);
    expect(mockConfigureLlmFetch.mock.calls[0]![0]).toBe(fetchMock);
  });

  it('进程内幂等：二次调用不重复注册', () => {
    const {ensureLlmFetchConfigured} = loadSetupModule(true);
    ensureLlmFetchConfigured();
    ensureLlmFetchConfigured();

    expect(mockConfigureLlmFetch).toHaveBeenCalledTimes(1);
    expect(mockRegisterNativeSseTransportWith).toHaveBeenCalledTimes(1);
  });
});
