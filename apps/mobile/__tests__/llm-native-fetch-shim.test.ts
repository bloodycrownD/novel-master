/**
 * T-N4（spec llm-stream-native §4 / 测试策略）：非流式 fetch shim 行为。
 *
 * - shim 经 native request 底座：转发参数（method/url/headers/body/callTimeout）
 * - GET 分发（无 body，含 method 缺省）与 POST 分发（带 body）各一例
 * - 非 2xx 按 Response.ok 语义返回不 reject；网络/超时错误 reject
 *   NativeSseTransportError（有限收敛，不挂起）
 * - shim 被流式误用：body 为 null，postSse fetch 分支消费路径命中
 *   core「Empty streaming response body」防御抛 ProviderError
 */

import {NativeSseTransportError} from '@novel-master/llm-sse-native';
import {
  LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
  createNativeRequestFetch,
  type LlmNativeRequestFn,
} from '../src/services/llm-native-fetch-shim';

// core 不公开 postSse / 分支强制位；Empty body 防御的集成断言必须经真实
// postSse fetch 分支消费路径，这里 deep-import dist 产物（与 moduleNameMapper
// 指向的 dist 同一文件实例，模块级注册位共享）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sseTransport = require('../../../packages/core/dist/infra/llm-protocol/logic/llm-sse-transport.js') as {
  postSse: (
    url: string,
    init: RequestInit,
    onChunk: (chunk: string) => void,
    providerId?: string,
    options?: {fetchFn?: typeof globalThis.fetch},
  ) => Promise<{status: number; contentType: string | null}>;
  setShouldUseXhrForSseOverrideForTests: (value: boolean | undefined) => void;
  resetShouldUseXhrForSseCacheForTests: () => void;
};

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
    sseTransport.resetShouldUseXhrForSseCacheForTests();
  });

  describe('method 分发与参数转发', () => {
    it('GET 分发：不传 body（listModels 形态），headers 扁平化，callTimeout 透传', async () => {
      const request = createMockRequest();
      const shim = createNativeRequestFetch(request);

      const response = await shim('https://api.example.com/v1/models', {
        method: 'GET',
        headers: {Authorization: 'Bearer sk-test', Accept: 'application/json'},
      });

      expect(request).toHaveBeenCalledWith(
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
      const shim = createNativeRequestFetch(request);

      await shim('https://api.example.com/v1/models', {headers: {}});

      expect(request).toHaveBeenCalledWith(
        'GET',
        'https://api.example.com/v1/models',
        [],
        null,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      );
    });

    it('POST 分发：JSON string body 原样透传（chatNonStream 形态）', async () => {
      const request = createMockRequest();
      const shim = createNativeRequestFetch(request);
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
        'POST',
        'https://api.example.com/v1/chat/completions',
        ['Authorization', 'Bearer sk-test', 'Content-Type', 'application/json'],
        body,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      );
    });

    it('非 GET/POST method 明确报错（shim 只承载非流式请求-响应）', async () => {
      const request = createMockRequest();
      const shim = createNativeRequestFetch(request);

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
      const shim = createNativeRequestFetch(request);

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

    it('非 2xx：按 Response.ok 语义返回不 reject，错误 body 经 text()/clone() 可读', async () => {
      const request = createMockRequest({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"overloaded"}',
      });
      const shim = createNativeRequestFetch(request);

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
      const shim = createNativeRequestFetch(request);

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
      const shim = createNativeRequestFetch(request);

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
      const shim = createNativeRequestFetch(request);

      await expect(
        shim('https://api.example.com/v1/models', {method: 'GET'}),
      ).rejects.toThrow('bridge exploded');
    });
  });

  describe('流式误用边界（spec §4：body 置 null 命中 Empty body 防御）', () => {
    it('postSse fetch 分支消费 shim → 抛 Empty streaming response body ProviderError', async () => {
      // 强制 fetch 分支（绕过 XHR 择优），fetchFn 注入 shim——复现
      // configureLlmFetch 的 fn 经 options.fetchFn 流入 fetch 分支的路径。
      sseTransport.setShouldUseXhrForSseOverrideForTests(false);
      const request = createMockRequest({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"choices":[]}\n\n',
      });
      const shim = createNativeRequestFetch(request);

      const chunks: string[] = [];
      await expect(
        sseTransport.postSse(
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
});
