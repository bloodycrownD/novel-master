/**
 * MCP 传输层 port：注入式请求函数 + 原始响应 + 传输错误。
 *
 * 只依赖一个极小的请求函数（桌面用 Node fetch 适配、移动端用原生 `request` 适配），
 * transport 自己读 status / headers / bodyText——只有它能看到 raw body，
 * 「原文透出」才成立。不经过 `assertOk`、不复用 `SseTransport`。
 *
 * @module infra/mcp/ports/mcp-transport.port
 */

/** 发给请求函数的单次 HTTP 请求描述。 */
export interface McpHttpRequest {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
}

/** 请求函数的返回：status + 头表 + 完整响应体文本。移动端原生 `request` 适配没有流、没有 `Response` 对象。 */
export interface McpHttpResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly bodyText: string;
}

/**
 * 极小请求函数契约：桌面 fetch 与移动端原生 `request` 各自适配成这个形态。
 * `signal` 中止时必须以 `AbortError`（name 为 "AbortError"）reject，transport 原样透传、不包装。
 */
export type McpRequestFn = (request: McpHttpRequest) => Promise<McpHttpResponse>;

/** 规范化后的响应原样：`contentType` 从 headers["content-type"] 提取，进错误对象的 `raw`。 */
export interface RawMcpResponse {
    readonly status: number;
    readonly contentType: string | null;
    readonly body: string;
}

/**
 * 传输层错误：非 2xx、content-type 不支持、解析失败、请求函数自身失败都走这里。
 *
 * `raw` 是「原文透出」的唯一前提——解析失败 / 非 2xx 时必须带上完整响应原文
 * （上层 `McpFailureClassifier.classify` 的入参就是 `raw` + `wwwAuthenticate`）；
 * 请求函数自身失败（网络断开）时没有响应可带，`raw` 为 null。
 * Promise 没有 Result 通道，属平台协议例外，此处允许 throw。
 */
export class McpTransportError extends Error {
    readonly raw: RawMcpResponse | null;
    readonly wwwAuthenticate: string | null;

    constructor(message: string, raw: RawMcpResponse | null = null, wwwAuthenticate: string | null = null) {
        super(message);
        this.name = "McpTransportError";
        this.raw = raw;
        this.wwwAuthenticate = wwwAuthenticate;
    }
}
