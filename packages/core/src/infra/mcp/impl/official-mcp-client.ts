/**
 * 官方 `@modelcontextprotocol/client` 的 `Client` 封装（spec Step 8）：一个实例对应
 * 一个 MCP server 的常驻会话，`connect(transport)` 默认 legacy 握手（2.4.0 的
 * `ClientOptions.versionNegotiation` 缺省即 legacy），握手、版本/能力协商与
 * tools/list 分页全部交给官方 Client。
 *
 * 关键在 {@link AbortRelayTransport}：2.4.0 的 `Protocol.request` 只在 modern era +
 * per-request-stream 下才给 transport 传 `requestSignal`（legacy 握手下恒为
 * undefined），调用方 signal 中止只会被官方包成 `SdkError(REQUEST_TIMEOUT)` 并发
 * `notifications/cancelled`——底层 HTTP 请求没人收割。这层 transport 把「当前在途
 * 逻辑请求」的 signal 合并进每次 send 的 `requestSignal`，请求函数侧（移动端原生
 * `request` 适配）据此落地 requestAbort 真断连；{@link OfficialMcpClient.withSignal}
 * 再与 signal 竞速，中止时以 AbortError 原样 reject（取消不进 Result，spec §五）。
 *
 * @module infra/mcp/impl/official-mcp-client
 */

import { Client, type CallToolResult, type JSONRPCMessage, type MessageExtraInfo, type Transport, type TransportSendOptions } from "@modelcontextprotocol/client";
import { Guards } from "@/common/guards.js";
import { AbortError } from "@/domain/abort/logic/create-abort-error.js";
import { HttpMcpTransport } from "@/infra/mcp/impl/http-mcp-transport.js";
import type { McpRequestFn } from "@/infra/mcp/ports/mcp-transport.port.js";

/** 服务器侧工具的窄投影：快照需要 name / description / 入参 Schema，官方 Tool 类型不外泄。 */
export interface McpRemoteTool {
    readonly name: string;
    readonly description?: string;
    /** 服务器声明的入参 JSON Schema；不是对象时省略（模型看到空参数定义）。 */
    readonly inputSchema?: Readonly<Record<string, unknown>>;
}

/** 建连依赖：端点 + 注入请求函数 + bearer token + 单请求超时（握手 / listTools / callTool 各自适用）。 */
export interface OfficialMcpClientDeps {
    readonly url: string;
    readonly requestFn: McpRequestFn;
    readonly authToken?: string | null;
    readonly timeoutMs: number;
}

/** 握手用的 clientInfo（serverInfo 展示与协商用，nm 不依赖版本号语义）。 */
const CLIENT_INFO = { name: "nm", version: "1" } as const;

/**
 * AbortSignal 转发 transport：包住 {@link HttpMcpTransport}，把在途逻辑请求集合里
 * 的全部 signal 合并进每次 send 的 `requestSignal`（与官方传入的 requestSignal、
 * 额外头等其他选项一起原样透传）。其余成员全部转发内层 transport。
 */
class AbortRelayTransport implements Transport {
    private readonly inner: HttpMcpTransport;
    /** 在途逻辑请求的 signal 集合（OfficialMcpClient.withSignal 增删，send 时并入 requestSignal）。 */
    readonly activeSignals = new Set<AbortSignal>();

    constructor(inner: HttpMcpTransport) {
        this.inner = inner;
    }

    get sessionId(): string | undefined {
        return this.inner.sessionId;
    }

    get onclose(): (() => void) | undefined {
        return this.inner.onclose;
    }

    set onclose(handler: (() => void) | undefined) {
        this.inner.onclose = handler;
    }

    get onerror(): ((error: Error) => void) | undefined {
        return this.inner.onerror;
    }

    set onerror(handler: ((error: Error) => void) | undefined) {
        this.inner.onerror = handler;
    }

    get onmessage(): (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined {
        return this.inner.onmessage;
    }

    set onmessage(handler: ((<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined)) {
        this.inner.onmessage = handler;
    }

    async start(): Promise<void> {
        await this.inner.start();
    }

    /** nm-style: keep-public — 官方 Transport 接口实现；官方 Protocol 在 initialize 响应后按名回调，按名计数看不见运行时调用。 */
    setProtocolVersion(version: string): void {
        this.inner.setProtocolVersion(version);
    }

    async close(): Promise<void> {
        await this.inner.close();
    }

    async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        const sources = [...this.activeSignals, options?.requestSignal].filter((source): source is AbortSignal => source != null);
        if (sources.length === 0) return this.inner.send(message, options);
        const alreadyAborted = sources.find((source) => source.aborted);
        if (alreadyAborted !== undefined) return this.inner.send(message, {...options, requestSignal: alreadyAborted});
        // 任一在途 signal（或官方传入的 requestSignal）abort 都终止底层请求；摘除监听防止挂到长寿命 signal 上。
        const controller = new AbortController();
        const disposers: Array<() => void> = [];
        for (const source of sources) {
            const handler = () => {
                for (const dispose of disposers) dispose();
                controller.abort(source.reason);
            };
            source.addEventListener("abort", handler, { once: true });
            disposers.push(() => source.removeEventListener("abort", handler));
        }
        try {
            return await this.inner.send(message, {...options, requestSignal: controller.signal});
        } finally {
            for (const dispose of disposers) dispose();
        }
    }
}

/** 单个 MCP server 的官方 Client 会话：建连、tools/list、tools/call、close。方法级 signal 同时承担客户端侧取消（AbortError 原样 reject）与底层请求的真断连（经 AbortRelayTransport 并进 requestSignal）。 */
export class OfficialMcpClient {
    private readonly deps: OfficialMcpClientDeps;
    private readonly relay: AbortRelayTransport;
    private readonly client: Client;

    private constructor(deps: OfficialMcpClientDeps, relay: AbortRelayTransport, client: Client) {
        this.deps = deps;
        this.relay = relay;
        this.client = client;
    }

    /** 建连：new Client + HttpMcpTransport + AbortRelay + connect（默认 legacy 握手，timeoutMs 约束握手这一单请求）；signal 中止以 AbortError reject。 */
    static async connect(deps: OfficialMcpClientDeps, signal: AbortSignal): Promise<OfficialMcpClient> {
        const relay = new AbortRelayTransport(new HttpMcpTransport({ url: deps.url, requestFn: deps.requestFn, authToken: deps.authToken ?? null }));
        const client = new Client(CLIENT_INFO);
        const instance = new OfficialMcpClient(deps, relay, client);
        await instance.withSignal(signal, () => client.connect(relay, { timeout: deps.timeoutMs }));
        return instance;
    }

    /** tools/list（无参调用走官方 auto-aggregate 全量分页；cacheMode refresh 保证快照拉取不命中官方缓存），返回窄投影。 */
    async listTools(signal: AbortSignal): Promise<readonly McpRemoteTool[]> {
        return this.withSignal(signal, async () => {
            const result = await this.client.listTools(undefined, { timeout: this.deps.timeoutMs, cacheMode: "refresh" });
            return result.tools.map((tool) => ({ name: tool.name, ...(tool.description === undefined ? {} : {description: tool.description}), ...(Guards.isRecord(tool.inputSchema) ? {inputSchema: tool.inputSchema} : {}) }));
        });
    }

    /** 最近一次响应里服务器下发的会话编号（会话失效判据用：404 且此前持有会话才算会话失效；`close()` 会清掉）。 */
    sessionId(): string | null {
        return this.relay.sessionId ?? null;
    }

    /** tools/call：CallToolResult 原样返回（content / isError 的消费在 toNmTool）；非对象入参收空对象。 */
    async callTool(toolName: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
        return this.withSignal(signal, () => this.client.callTool({ name: toolName, arguments: Guards.isRecord(args) ? args : {} }, { timeout: this.deps.timeoutMs }));
    }

    /** 关闭会话（连接管理器 closeAll 时调）。 */
    async close(): Promise<void> {
        await this.client.close();
    }

    /** 逻辑请求统一入口：signal 并进 relay（底层收割）+ 与 signal 竞速（客户端侧取消，先于官方把中止包装成 SdkError(REQUEST_TIMEOUT)）。 */
    private async withSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
        this.relay.activeSignals.add(signal);
        try {
            return await new Promise<T>((resolve, reject) => {
                const onAbort = () => reject(AbortError.create());
                const cleanup = () => signal.removeEventListener("abort", onAbort);
                if (signal.aborted) {
                    reject(AbortError.create());
                    return;
                }
                run().then((value) => {
                    cleanup();
                    resolve(value);
                }, (error: unknown) => {
                    cleanup();
                    reject(error);
                });
                signal.addEventListener("abort", onAbort, { once: true });
            });
        } finally {
            this.relay.activeSignals.delete(signal);
        }
    }
}
