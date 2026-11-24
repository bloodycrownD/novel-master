/**
 * T-M16b（spec mcp-support 测试策略 / Step 6）：移动端 MCP 请求适配。
 *
 * - 原生分支：参数转发（method/url/headers 扁平化/body/timeoutMs 即 callTimeout）
 *   与返回形状 {status, headers, bodyText}（headers 透传键名小写全头表）；
 *   旧 APK 缺 headers 字段按空对象处理
 * - 取消：signal 已 aborted 立刻 AbortError（请求不发出）；途中中止先调
 *   requestAbort(同一 requestId) 真断连再立刻 AbortError；native 迟到 settle
 *   不二次 settle、不重复断连
 * - reject code 映射（spec Step 6）：network/timeout → failure
 *   {kind:"network", action:"retry"}；invalid → {kind:"protocol",
 *   action:"report"}；abort → AbortError；非 GET/POST 误用防御性归位
 *   protocol/report 且请求不发出
 * - 原生未注册：回落注入的 fetchFn，响应头全小写收集；外层 signal 中止归
 *   AbortError；自带定时器到点归 network/retry（不冒充用户取消）；fetch
 *   网络失败归 network/retry
 */

import {NativeSseAbortError} from '@novel-master/llm-sse-native';
import type {LlmNativeRequestFn} from '../src/services/llm-native-fetch-shim';
import {McpNativeRequestError, McpRequestAdapter, type McpRequestInput} from '../src/services/mcp-request-adapter';

/** native request / 回落 fetch 迟到 settle 用的 deferred（测取消时序）。 */
function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

/** 造一个记录调用参数的 mock native request（headers 模拟新 APK 的键名小写全头表）。 */
function createMockRequest(result: {status: number; contentType: string | null; body: string; headers?: Record<string, string>} = {status: 200, contentType: 'application/json', body: '{"jsonrpc":"2.0","id":1,"result":{}}', headers: {'content-type': 'application/json', 'mcp-session-id': 'session-1'}}) {
    const request = jest.fn(async () => result);
    return request as unknown as jest.Mock & LlmNativeRequestFn;
}

/** MCP transport 的标准请求入参（initialize 形态）。 */
function mcpRequest(overrides: Partial<McpRequestInput> = {}): McpRequestInput {
    return {
        url: 'https://mcp.example.com/mcp',
        method: 'POST',
        headers: {'accept': 'application/json, text/event-stream', 'content-type': 'application/json'},
        body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
        ...overrides,
    };
}

/** 造一个最小 fetch Response 形状（jest 环境无 DOM lib，headers 用 forEach 回调模拟）。 */
function createFakeResponse(shape: {status: number; headerPairs: [value: string, name: string][]; bodyText: string}): Response {
    const response = {
        status: shape.status,
        headers: {
            forEach: (cb: (value: string, name: string) => void): void => {
                for (const [value, name] of shape.headerPairs) {
                    cb(value, name);
                }
            },
        },
        text: async () => shape.bodyText,
    };
    return response as unknown as Response;
}

describe('mcp-request-adapter (T-M16b)', () => {
    describe('原生分支（request 已注册）', () => {
        it('参数转发：method/url/headers 扁平化/body/timeoutMs 即 callTimeout；返回全头表与 body 原文', async () => {
            const request = createMockRequest({
                status: 200,
                contentType: 'application/json',
                body: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
                headers: {'content-type': 'application/json', 'mcp-session-id': 'session-1', 'www-authenticate': 'Bearer realm="x"'},
            });
            const adapter = McpRequestAdapter.create({request, timeoutMs: 123456});

            const out = await adapter(mcpRequest());

            expect(request).toHaveBeenCalledWith(expect.stringMatching(/^mcp-request-[0-9a-z]{6}-\d+$/), 'POST', 'https://mcp.example.com/mcp', ['accept', 'application/json, text/event-stream', 'content-type', 'application/json'], '{"jsonrpc":"2.0","id":1,"method":"initialize"}', 123456);
            expect(out).toEqual({
                status: 200,
                headers: {'content-type': 'application/json', 'mcp-session-id': 'session-1', 'www-authenticate': 'Bearer realm="x"'},
                bodyText: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
            });
        });

        it('旧 APK 缺 headers 字段：按空对象处理，status 与 body 原文照常返回', async () => {
            const request = createMockRequest({status: 404, contentType: 'text/html', body: '<html>404</html>'});
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            const out = await adapter(mcpRequest());

            expect(out.status).toBe(404);
            expect(out.headers).toEqual({});
            expect(out.bodyText).toBe('<html>404</html>');
        });

        it('每请求生成独立 requestId（mcp-request 命名空间，不与 fetch shim / 流式 transport 撞 id）', async () => {
            const request = createMockRequest();
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            await Promise.all([adapter(mcpRequest()), adapter(mcpRequest())]);

            const firstId = request.mock.calls[0]![0] as string;
            const secondId = request.mock.calls[1]![0] as string;
            expect(firstId).toMatch(/^mcp-request-[0-9a-z]{6}-\d+$/);
            expect(secondId).toMatch(/^mcp-request-[0-9a-z]{6}-\d+$/);
            expect(firstId).not.toBe(secondId);
        });

        it('signal 已 aborted：立刻 AbortError reject，native 请求不发出、也不调 requestAbort', async () => {
            const request = createMockRequest();
            const requestAbort = jest.fn();
            const adapter = McpRequestAdapter.create({request, requestAbort, timeoutMs: 120000});
            const controller = new AbortController();
            controller.abort();

            await expect(adapter(mcpRequest({signal: controller.signal}))).rejects.toMatchObject({name: 'AbortError'});
            expect(request).not.toHaveBeenCalled();
            expect(requestAbort).not.toHaveBeenCalled();
        });

        it('请求途中 abort：先调 requestAbort(同一 requestId) 真断连，再立刻 reject AbortError；native 迟到 settle 不二次 settle', async () => {
            const deferred = createDeferred<{status: number; contentType: string | null; body: string; headers?: Record<string, string>}>();
            const request = jest.fn(
                () => deferred.promise,
            ) as unknown as jest.Mock & LlmNativeRequestFn;
            const requestAbort = jest.fn();
            const adapter = McpRequestAdapter.create({request, requestAbort, timeoutMs: 120000});
            const controller = new AbortController();

            const promise = adapter(mcpRequest({signal: controller.signal}));
            const requestId = request.mock.calls[0]![0] as string;
            expect(request).toHaveBeenCalledTimes(1);

            controller.abort();
            await expect(promise).rejects.toBeInstanceOf(NativeSseAbortError);
            await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});
            expect(requestAbort).toHaveBeenCalledTimes(1);
            expect(requestAbort).toHaveBeenCalledWith(requestId);

            // native 侧迟到 settle：结果被丢弃，不产生未处理的 rejection、不再改写已 settle 的 promise。
            deferred.resolve({status: 200, contentType: 'application/json', body: '{}', headers: {}});
            await Promise.resolve();
            await expect(promise).rejects.toMatchObject({name: 'AbortError', requestId});
            expect(requestAbort).toHaveBeenCalledTimes(1);
        });

        it('native reject code="abort"（无 signal）：映射为 AbortError 而非网络失败', async () => {
            const request = jest.fn(async () => {
                throw Object.assign(new Error('aborted by user'), {code: 'abort'});
            }) as unknown as LlmNativeRequestFn;
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            await expect(adapter(mcpRequest())).rejects.toMatchObject({name: 'AbortError'});
        });

        it('native reject code="network" → failure {kind:"network", action:"retry"}，detail 携带原文', async () => {
            const request = jest.fn(async () => {
                throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'network'});
            }) as unknown as LlmNativeRequestFn;
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            // 同一 promise 上做两类断言（rejects 断言会重新调用 adapter，不能各调一次）。
            const promise = adapter(mcpRequest());
            await expect(promise).rejects.toBeInstanceOf(McpNativeRequestError);
            await expect(promise).rejects.toMatchObject({name: 'McpNativeRequestError', failure: {kind: 'network', action: 'retry', detail: 'connect ECONNREFUSED'}});
        });

        it('native reject code="timeout"（callTimeout 到点）→ failure {kind:"network", action:"retry"}', async () => {
            const request = jest.fn(async () => {
                throw Object.assign(new Error('call timeout after 120000ms'), {code: 'timeout'});
            }) as unknown as LlmNativeRequestFn;
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            await expect(adapter(mcpRequest())).rejects.toMatchObject({failure: {kind: 'network', action: 'retry', detail: 'call timeout after 120000ms'}});
        });

        it('native reject code="invalid" → failure {kind:"protocol", action:"report"}（防御性归位）', async () => {
            const request = jest.fn(async () => {
                throw Object.assign(new Error('duplicate requestId: mcp-request-x-1'), {code: 'invalid'});
            }) as unknown as LlmNativeRequestFn;
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            await expect(adapter(mcpRequest())).rejects.toMatchObject({failure: {kind: 'protocol', action: 'report', detail: 'duplicate requestId: mcp-request-x-1'}});
        });

        it('非 GET/POST method：防御性归位 protocol/report，native 请求不发出', async () => {
            const request = createMockRequest();
            const adapter = McpRequestAdapter.create({request, timeoutMs: 120000});

            await expect(adapter(mcpRequest({method: 'DELETE'}))).rejects.toMatchObject({failure: {kind: 'protocol', action: 'report'}});
            expect(request).not.toHaveBeenCalled();
        });
    });

    describe('原生未注册：回落 fetch', () => {
        it('fetch 分发与返回形状：响应头全小写收集，bodyText 完整', async () => {
            const fetchFn = jest.fn(async () => createFakeResponse({
                status: 200,
                headerPairs: [['application/json', 'Content-Type'], ['session-1', 'Mcp-Session-Id']],
                bodyText: '{"jsonrpc":"2.0","id":1,"result":{}}',
            })) as unknown as jest.Mock & typeof globalThis.fetch;
            const adapter = McpRequestAdapter.create({request: null, timeoutMs: 120000, fetchFn});

            const out = await adapter(mcpRequest());

            expect(fetchFn).toHaveBeenCalledWith('https://mcp.example.com/mcp', {method: 'POST', headers: {'accept': 'application/json, text/event-stream', 'content-type': 'application/json'}, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}', signal: expect.any(AbortSignal)});
            expect(out).toEqual({
                status: 200,
                headers: {'content-type': 'application/json', 'mcp-session-id': 'session-1'},
                bodyText: '{"jsonrpc":"2.0","id":1,"result":{}}',
            });
        });

        it('signal 已 aborted：立刻 AbortError reject，fetch 不调用', async () => {
            const fetchFn = jest.fn(async () => createFakeResponse({status: 200, headerPairs: [], bodyText: ''})) as unknown as typeof globalThis.fetch;
            const adapter = McpRequestAdapter.create({request: null, timeoutMs: 120000, fetchFn});
            const controller = new AbortController();
            controller.abort();

            await expect(adapter(mcpRequest({signal: controller.signal}))).rejects.toMatchObject({name: 'AbortError'});
            expect(fetchFn).not.toHaveBeenCalled();
        });

        it('请求途中 abort：fetch 以 AbortError reject，不当网络失败', async () => {
            const fetchFn = jest.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
                init.signal?.addEventListener('abort', () => rej(new Error('Aborted')));
            })) as unknown as typeof globalThis.fetch;
            const adapter = McpRequestAdapter.create({request: null, timeoutMs: 120000, fetchFn});
            const controller = new AbortController();

            const promise = adapter(mcpRequest({signal: controller.signal}));
            controller.abort();

            await expect(promise).rejects.toMatchObject({name: 'AbortError'});
        });

        it('自带定时器到点（RN fetch 无超时语义）：归 network/retry，不冒充用户取消', async () => {
            jest.useFakeTimers();
            try {
                const fetchFn = jest.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
                    init.signal?.addEventListener('abort', () => rej(new Error('Aborted')));
                })) as unknown as typeof globalThis.fetch;
                const adapter = McpRequestAdapter.create({request: null, timeoutMs: 120000, fetchFn});

                const promise = adapter(mcpRequest());
                jest.advanceTimersByTime(120000);

                await expect(promise).rejects.toMatchObject({name: 'McpNativeRequestError', failure: {kind: 'network', action: 'retry', detail: 'call timeout after 120000ms'}});
            } finally {
                jest.useRealTimers();
            }
        });

        it('fetch 网络失败：归 network/retry，detail 携带原文', async () => {
            const fetchFn = jest.fn(async () => {
                throw new TypeError('Network request failed');
            }) as unknown as typeof globalThis.fetch;
            const adapter = McpRequestAdapter.create({request: null, timeoutMs: 120000, fetchFn});

            await expect(adapter(mcpRequest())).rejects.toMatchObject({name: 'McpNativeRequestError', failure: {kind: 'network', action: 'retry', detail: 'Network request failed'}});
        });
    });

    describe('取消赛跑协议复用（与 fetch shim 同一 raceWithAbort）', () => {
        it('abort 后 native 以 code="abort" reject 迟到：不二次 settle、不重复断连', async () => {
            const deferred = createDeferred<{status: number; contentType: string | null; body: string}>();
            const request = jest.fn(
                () => deferred.promise,
            ) as unknown as jest.Mock & LlmNativeRequestFn;
            const requestAbort = jest.fn();
            const adapter = McpRequestAdapter.create({request, requestAbort, timeoutMs: 120000});
            const controller = new AbortController();

            const promise = adapter(mcpRequest({signal: controller.signal}));
            controller.abort();
            await expect(promise).rejects.toMatchObject({name: 'AbortError'});

            deferred.reject(Object.assign(new Error('aborted by user'), {code: 'abort'}));
            await Promise.resolve();
            await Promise.resolve();
            await expect(promise).rejects.toMatchObject({name: 'AbortError'});
            expect(requestAbort).toHaveBeenCalledTimes(1);
        });

        it('native 先 settle、abort 后到：按请求结果返回（赛跑口径，不触发真断连）', async () => {
            const request = createMockRequest();
            const requestAbort = jest.fn();
            const adapter = McpRequestAdapter.create({request, requestAbort, timeoutMs: 120000});
            const controller = new AbortController();

            const out = await adapter(mcpRequest({signal: controller.signal}));
            controller.abort();

            expect(out.status).toBe(200);
            expect(out.headers).toEqual({'content-type': 'application/json', 'mcp-session-id': 'session-1'});
            expect(requestAbort).not.toHaveBeenCalled();
        });
    });
});
