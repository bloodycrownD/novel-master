/**
 * T-N4（spec llm-stream-native §4 / 测试策略）：非流式 fetch shim 行为。
 *
 * - shim 经 native request 底座：转发参数（method/url/headers/body/callTimeout）
 * - GET 分发（无 body，含 method 缺省）与 POST 分发（带 body）各一例
 * - 非 2xx 按 Response.ok 语义返回不 reject；网络/超时错误 reject
 *   NativeSseTransportError（有限收敛，不挂起）
 * - 取消（shim-1 / T-S17）：signal 已 aborted 与请求途中 abort 两种时序均立刻
 *   AbortError reject；途中取消先调注入的 `requestAbort(requestId)` 真断连
 *   （OkHttp Call.cancel），native 的迟到 settle 不产生二次 settle
 * - native 请求契约（T-S20 的 JS 侧）：每请求独立 requestId（与流式路径不同
 *   命名空间，重复 id 不可能由 shim 生成）；native 的 `invalid` reject 原样上抛
 * - json()（shim-3）：非法 body 走 rejected Promise，不同步抛
 * - shim 被流式误用：body 为 null，LlmSseTransport.post fetch 分支消费路径命中
 *   core「Empty streaming response body」防御抛 ProviderError
 * - dev logging（shim-2）：body=null 的成功非流式响应不再误报
 *   「streaming may fail on RN」；真实流式请求 body 缺失仍告警
 */

import {NativeSseAbortError, NativeSseTransportError} from '@novel-master/llm-sse-native';
import {LLM_NATIVE_FETCH_CALL_TIMEOUT_MS, type LlmNativeRequestFn, LlmNativeFetchShim} from '../src/services/llm-native-fetch-shim'

// core 不公开 LlmSseTransport.post / 分支强制位；Empty body 防御的集成断言必须经真实
// post fetch 分支消费路径，这里 deep-import dist 产物（与 moduleNameMapper
// 指向的 dist 同一文件实例，模块级注册位共享）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sseTransport = require('../../../packages/core/dist/infra/llm-protocol/logic/llm-sse-transport.js') as {
  LlmSseTransport: {
    post: (
      url: string,
      init: RequestInit,
      onChunk: (chunk: string) => void,
      providerId?: string,
      options?: {fetchFn?: typeof globalThis.fetch},
    ) => Promise<{status: number; contentType: string | null}>;
    setShouldUseXhrOverrideForTests: (value: boolean | undefined) => void;
    resetShouldUseXhrCacheForTests: () => void;
  };
};

/** native request 迟到 settle 用的 deferred（测取消时序）。 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

/** 造一个记录调用参数的 mock native request。 */
function createMockRequest(
  result: {status: number; contentType: string | null; body: string} = {
    status: 200,
    contentType: 'application/json',
    body: '{"ok":true}',
  },
) {
  const request = jest.fn(async () => result);
  return request as unknown as jest.Mock & LlmNativeRequestFn;
}

describe('llm-native-fetch-shim (T-N4)', () => {
  afterEach(() => {
    sseTransport.LlmSseTransport.resetShouldUseXhrCacheForTests();
  });

  describe('method 分发与参数转发', () => {
    it('GET 分发：不传 body（listModels 形态），headers 扁平化，callTimeout 透传', async () => {
      const request = createMockRequest();
      const shim = LlmNativeFetchShim.create({request});

      const response = await shim('https://api.example.com/v1/models', {
        method: 'GET',
        headers: {Authorization: 'Bearer sk-test', Accept: 'application/json'},
      });

      expect(request).toHaveBeenCalledWith(
        expect.stringMatching(/^llm-native-fetch-[0-9a-z]{6}-\d+$/),
        'GET',
        'https://api.example.com/v1/models',
        ['Authorization', 'Bearer sk-test', 'Accept', 'application/json'],
        null,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      );
      expect(response.ok).toBe(true);
    });

    it('method 缺省按 GET 分发（fetch 语义默认值）', async () => {
      const request = createMockRequest();
      const shim = LlmNativeFetchShim.create({request});

      await shim('https://api.example.com/v1/models', {headers: {}});

      expect(request).toHaveBeenCalledWith(
        expect.stringMatching(/^llm-native-fetch-[0-9a-z]{6}-\d+$/),
        'GET',
        'https://api.example.com/v1/models',
        [],
        null,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      );
    });

    it('POST 分发：JSON string body 原样透传（chatNonStream 形态）', async () => {
      const request = createMockRequest();
      const shim = LlmNativeFetchShim.create({request});
      const body = JSON.stringify({model: 'gpt-test', messages: []});

      await shim('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        headers: [
          ['Authorization', 'Bearer sk-test'],
          ['Content-Type', 'application/json'],
        ],
        body,
      });

      expect(request).toHaveBeenCalledWith(
        expect.stringMatching(/^llm-native-fetch-[0-9a-z]{6}-\d+$/),
        'POST',
        'https://api.example.com/v1/chat/completions',
        ['Authorization', 'Bearer sk-test', 'Content-Type', 'application/json'],
        body,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      );
    });

    it('非 GET/POST method 明确报错（shim 只承载非流式请求-响应）', async () => {
      const request = createMockRequest();
      const shim = LlmNativeFetchShim.create({request});

      await expect(
        shim('https://api.example.com/put', {method: 'PUT'}),
      ).rejects.toThrow('GET/POST');
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('Response 形状（最小消费面）', () => {
    it('2xx：ok=true，text()/json()/headers.get 生效，body 恒为 null', async () => {
      const request = createMockRequest({
        status: 200,
        contentType: 'application/json',
        body: '{"data":[{"id":"m-1"}]}',
      });
      const shim = LlmNativeFetchShim.create({request});

      const response = await shim('https://api.example.com/v1/models', {
        method: 'GET',
      });

      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      expect(response.body).toBeNull();
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('x-other')).toBeNull();
      await expect(response.text()).resolves.toBe('{"data":[{"id":"m-1"}]}');
      await expect(response.json()).resolves.toEqual({data: [{id: 'm-1'}]});
    });

    it('json() 对非法 body 返回 rejected Promise（不同步抛，符合 fetch 契约）', async () => {
      const request = createMockRequest({
        status: 200,
        contentType: 'text/plain',
        body: 'not-json',
      });
      const shim = LlmNativeFetchShim.create({request});

      const response = await shim('https://api.example.com/v1/models', {
        method: 'GET',
      });

      // 同步路径不得抛（旧实现 JSON.parse 在调用点直接执行）。
      let promise: Promise<unknown> | undefined;
      expect(() => {
        promise = response.json();
      }).not.toThrow();
      await expect(promise).rejects.toBeInstanceOf(SyntaxError);
    });

    it('非 2xx：按 Response.ok 语义返回不 reject，错误 body 经 text()/clone() 可读', async () => {
      const request = createMockRequest({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"overloaded"}',
      });
      const shim = LlmNativeFetchShim.create({request});

      const response = await shim('https://api.example.com/v1/chat', {
        method: 'POST',
        body: '{}',
      });

      expect(response.status).toBe(503);
      expect(response.ok).toBe(false);
      await expect(response.clone().text()).resolves.toBe(
        '{"error":"overloaded"}',
      );
      // 消费面 assertOk 走 text() 摘要——同一份 body 文本。
      await expect(response.text()).resolves.toBe('{"error":"overloaded"}');
    });
  });

  describe('native 错误透传（有限收敛，不挂起）', () => {
    it('bridge code=network → reject NativeSseTransportError(kind network)', async () => {
      const request = jest.fn(async () => {
        const err = new Error('connect ECONNREFUSED') as Error & {
          code?: string;
        };
        err.code = 'network';
        throw err;
      }) as unknown as LlmNativeRequestFn;
      const shim = LlmNativeFetchShim.create({request});

      await expect(
        shim('https://dead.example.com/v1/models', {method: 'GET'}),
      ).rejects.toMatchObject({
        name: 'NativeSseTransportError',
        kind: 'network',
      });
    });

    it('bridge code=timeout（callTimeout 到点/服务端死亡）→ reject kind timeout', async () => {
      const request = jest.fn(async () => {
        const err = new Error('timeout') as Error & {code?: string};
        err.code = 'timeout';
        throw err;
      }) as unknown as LlmNativeRequestFn;
      const shim = LlmNativeFetchShim.create({request});

      const promise = shim('https://slow.example.com/v1/chat', {
        method: 'POST',
        body: '{}',
      });
      // reject 而非 pending：await 断言本身即在有限时间内 settle。
      await expect(promise).rejects.toBeInstanceOf(NativeSseTransportError);
    });

    it('未知错误原样上抛（不吞不换形态）', async () => {
      const request = jest.fn(async () => {
        throw new Error('bridge exploded');
      }) as unknown as LlmNativeRequestFn;
      const shim = LlmNativeFetchShim.create({request});

      await expect(
        shim('https://api.example.com/v1/models', {method: 'GET'}),
      ).rejects.toThrow('bridge exploded');
    });
  });

  describe('取消语义（shim-1 / T-S17：立刻 AbortError + requestAbort 真断连）', () => {
    it('signal 已 aborted：立刻 reject AbortError，native 请求不发出、也不调 requestAbort', async () => {
      const request = createMockRequest();
      const requestAbort = jest.fn();
      const shim = LlmNativeFetchShim.create({request, requestAbort});
      const controller = new AbortController();
      controller.abort();

      await expect(
        shim('https://api.example.com/v1/models', {
          method: 'GET',
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({name: 'AbortError'});
      expect(request).not.toHaveBeenCalled();
      expect(requestAbort).not.toHaveBeenCalled();
    });

    it('T-S17 请求途中 abort：先调 requestAbort(同一 requestId) 真断连，再立刻 reject AbortError', async () => {
      const deferred = createDeferred<{
        status: number;
        contentType: string | null;
        body: string;
      }>();
      const request = jest.fn(
        () => deferred.promise,
      ) as unknown as jest.Mock & LlmNativeRequestFn;
      const requestAbort = jest.fn();
      const shim = LlmNativeFetchShim.create({request, requestAbort});
      const controller = new AbortController();

      const promise = shim('https://api.example.com/v1/chat', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });
      // native 侧收到的取消路由键：abort 必须用同一个 id 调 requestAbort。
      const requestId = request.mock.calls[0]![0] as string;
      expect(request).toHaveBeenCalledTimes(1);
      expect(requestId).toMatch(/^llm-native-fetch-[0-9a-z]{6}-\d+$/);

      controller.abort();
      // abort 即 settle：native 的 deferred 还没 resolve，断言就能等到 rejection。
      await expect(promise).rejects.toBeInstanceOf(NativeSseAbortError);
      await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});
      expect(requestAbort).toHaveBeenCalledTimes(1);
      expect(requestAbort).toHaveBeenCalledWith(requestId);

      // native 侧迟到 settle：结果被丢弃，不产生未处理的 rejection、
      // 也不再改写已 settle 的 promise、不重复触发 requestAbort。
      deferred.resolve({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      await Promise.resolve();
      await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});
      expect(requestAbort).toHaveBeenCalledTimes(1);
    });

    it('T-S17 abort 后 native 以 code="abort" reject 迟到：不二次 settle、不重复断连', async () => {
      const deferred = createDeferred<{
        status: number;
        contentType: string | null;
        body: string;
      }>();
      const request = jest.fn(
        () => deferred.promise,
      ) as unknown as jest.Mock & LlmNativeRequestFn;
      const requestAbort = jest.fn();
      const shim = LlmNativeFetchShim.create({request, requestAbort});
      const controller = new AbortController();

      const promise = shim('https://api.example.com/v1/chat', {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });
      const requestId = request.mock.calls[0]![0] as string;

      controller.abort();
      await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});

      // 真断连后 native 的 promise 以 reject("abort") 收尾：迟到 rejection
      // 必须被 race 的 settled 分支吞掉（Promise 已挂 handler，无未处理 rejection）。
      deferred.reject(Object.assign(new Error('aborted by user'), {code: 'abort'}));
      await Promise.resolve();
      await Promise.resolve();
      await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});
      expect(requestAbort).toHaveBeenCalledTimes(1);
    });

    it('T-S17 native 侧取消经 reject("abort") 回传（无 signal）：映射为 AbortError 而非网络错误', async () => {
      const request = jest.fn(async () => {
        throw Object.assign(new Error('aborted by user'), {code: 'abort'});
      }) as unknown as LlmNativeRequestFn;
      const requestAbort = jest.fn();
      const shim = LlmNativeFetchShim.create({request, requestAbort});

      await expect(
        shim('https://api.example.com/v1/models', {method: 'GET'}),
      ).rejects.toMatchObject({name: 'AbortError'});
      expect(requestAbort).not.toHaveBeenCalled();
    });

    it('native 先 settle、abort 后到：按请求结果返回（赛跑口径，不触发真断连）', async () => {
      const request = createMockRequest();
      const requestAbort = jest.fn();
      const shim = LlmNativeFetchShim.create({request, requestAbort});
      const controller = new AbortController();

      const response = await shim('https://api.example.com/v1/models', {
        method: 'GET',
        signal: controller.signal,
      });
      controller.abort();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ok: true});
      expect(requestAbort).not.toHaveBeenCalled();
    });
  });

  describe('requestId 贯穿与契约错误（T-S20 的 JS 侧）', () => {
    it('每请求生成独立 requestId（llm-native-fetch 命名空间，不与流式 llm-sse 共用）', async () => {
      const request = createMockRequest();
      const shim = LlmNativeFetchShim.create({request});

      await Promise.all([
        shim('https://api.example.com/v1/models', {method: 'GET'}),
        shim('https://api.example.com/v1/models', {method: 'GET'}),
      ]);

      const firstId = request.mock.calls[0]![0] as string;
      const secondId = request.mock.calls[1]![0] as string;
      expect(firstId).toMatch(/^llm-native-fetch-[0-9a-z]{6}-\d+$/);
      expect(secondId).toMatch(/^llm-native-fetch-[0-9a-z]{6}-\d+$/);
      expect(firstId).not.toBe(secondId);
      // 流式 transport 的 id 形态是 `llm-sse-*`；命名空间隔离后两边永不撞 id
      // （native 侧 putIfAbsent 撞到重复 id 会直接 reject("invalid")）。
      expect(firstId.startsWith('llm-sse-')).toBe(false);
      expect(secondId.startsWith('llm-sse-')).toBe(false);
    });

    it('native 契约错误 code="invalid"（如重复 requestId）原样上抛，不吞成传输错误', async () => {
      const request = jest.fn(async () => {
        throw Object.assign(new Error('duplicate requestId: x'), {
          code: 'invalid',
        });
      }) as unknown as LlmNativeRequestFn;
      const shim = LlmNativeFetchShim.create({request});

      await expect(
        shim('https://api.example.com/v1/models', {method: 'GET'}),
      ).rejects.toMatchObject({code: 'invalid'});
    });
  });

  describe('流式误用边界（spec §4：body 置 null 命中 Empty body 防御）', () => {
    it('LlmSseTransport.post fetch 分支消费 shim → 抛 Empty streaming response body ProviderError', async () => {
      // 强制 fetch 分支（绕过 XHR 择优），fetchFn 注入 shim——复现
      // Registry.configureLlmFetch 的 fn 经 options.fetchFn 流入 fetch 分支的路径。
      sseTransport.LlmSseTransport.setShouldUseXhrOverrideForTests(false);
      const request = createMockRequest({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"choices":[]}\n\n',
      });
      const shim = LlmNativeFetchShim.create({request});

      const chunks: string[] = [];
      await expect(
        sseTransport.LlmSseTransport.post(
          'https://api.example.com/v1/chat/completions',
          {method: 'POST', headers: {Authorization: 'Bearer sk'}, body: '{}'},
          chunk => chunks.push(chunk),
          undefined,
          {fetchFn: shim},
        ),
      ).rejects.toThrow('Empty streaming response body');

      // 误用不产生任何 chunk 投递（防御在 reader 建立前抛出）。
      expect(chunks).toEqual([]);
    });
  });

  describe('dev logging（shim-2：收窄告警判据，非流式 body=null 不再误报）', () => {
    // core 不公开 debug-fetch 子路径，告警判据在 core 侧；这里 deep-import dist
    // 产物做黑盒断言（与上方 llm-sse-transport deep-import 同一口径；dist 重建
    // 后本组即该判据的护栏）。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {DebugFetch} = require('../../../packages/core/dist/infra/llm-protocol/logic/debug-fetch.js') as {
      DebugFetch: {
        createLoggingFetch: (
          base: typeof globalThis.fetch,
        ) => typeof globalThis.fetch;
      };
    };

    const originalDev = (globalThis as {__DEV__?: boolean}).__DEV__;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      (globalThis as {__DEV__?: boolean}).__DEV__ = true;
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      (globalThis as {__DEV__?: boolean}).__DEV__ = originalDev;
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    /** 是否命中「streaming may fail on RN」告警。 */
    const warnedStreamingMayFail = (): boolean =>
      warnSpy.mock.calls.some((call) =>
        call.join(' ').includes('streaming may fail on RN'),
      );

    it('body=null 的成功非流式响应（GET / stream:false POST）不产生流式告警', async () => {
      const request = createMockRequest({
        status: 200,
        contentType: 'application/json',
        body: '{"data":[]}',
      });
      const logged = DebugFetch.createLoggingFetch(
        LlmNativeFetchShim.create({request}) as unknown as typeof globalThis.fetch,
      );

      await logged('https://api.example.com/v1/models', {
        method: 'GET',
        headers: {},
      });
      await logged('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model: 'gpt-test', stream: false, messages: []}),
      });

      expect(warnedStreamingMayFail()).toBe(false);
    });

    it('真实流式请求（body stream:true）响应 body 缺失仍告警', async () => {
      const request = createMockRequest({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {}\n\n',
      });
      const logged = DebugFetch.createLoggingFetch(
        LlmNativeFetchShim.create({request}) as unknown as typeof globalThis.fetch,
      );

      await logged('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model: 'gpt-test', stream: true, messages: []}),
      });

      expect(warnedStreamingMayFail()).toBe(true);
    });

    it('Gemini 流式（URL alt=sse，body 无 stream 字段）响应 body 缺失仍告警', async () => {
      const request = createMockRequest({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {}\n\n',
      });
      const logged = DebugFetch.createLoggingFetch(
        LlmNativeFetchShim.create({request}) as unknown as typeof globalThis.fetch,
      );

      await logged(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent?key=k&alt=sse',
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents: []}),
        },
      );

      expect(warnedStreamingMayFail()).toBe(true);
    });
  });
});
