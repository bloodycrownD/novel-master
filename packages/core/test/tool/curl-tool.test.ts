import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import {
  CURL_MAX_BODY_BYTES,
  curlTool,
} from "../../src/domain/tool/builtin/curl-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
  isCurlOutput,
  isGlobOutput,
  isGrepOutput,
  isReadOutput,
} from "../../src/domain/tool/logic/format-tool-output.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { resolveAgentToolRegistry } from "../../src/domain/agent/logic/resolve-agent-tool-registry.js";
import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";

afterEach(() => {
  mock.timers.reset();
});

/** 构造 fake Response：记录 text() 调用次数（预检/非文本用例断言不读 body）。 */
function fakeResponse(
  overrides: {
    readonly status?: number;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    /** 挂起 body：text() 永不 resolve，监听该 signal 在 abort 时 reject
     * （模拟 undici 对 body 读取的中断语义，用于慢滴流超时用例）。 */
    readonly pendingBodySignal?: AbortSignal;
  } = {},
): Response & { readonly textCalls: () => number } {
  let calls = 0;
  const base = {
    status: overrides.status ?? 200,
    url: overrides.url ?? "",
    headers: new Headers(overrides.headers ?? {}),
    text: () => {
      calls += 1;
      if (overrides.pendingBodySignal != null) {
        return new Promise<string>((_resolve, reject) => {
          overrides.pendingBodySignal!.addEventListener("abort", () => {
            reject(
              new DOMException(
                "This operation was aborted",
                "AbortError",
              ),
            );
          });
        });
      }
      return Promise.resolve(overrides.body ?? "");
    },
  };
  return Object.assign(base as unknown as Response, {
    textCalls: () => calls,
  });
}

/** 构造注入 mock fetchFn 的 BuiltinToolContext（其余字段照 skill-tool 先例占位）。 */
function makeCtx(
  fetchFn: typeof fetch,
  extra?: { readonly allowedPaths?: readonly string[] },
): BuiltinToolContext {
  return {
    vfs: {} as never,
    projectId: "proj-1",
    sessionId: "sess-1",
    listSessionMessages: async () => [],
    fetchFn,
    ...(extra?.allowedPaths != null
      ? { allowedPaths: extra.allowedPaths }
      : {}),
  };
}

function makeRunner(): {
  readonly runner: ToolRunner<BuiltinToolContext>;
  readonly registry: ToolRegistry<BuiltinToolContext>;
} {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return { runner: new ToolRunner(registry), registry };
}

describe("curl 工具", () => {
  it("T-CT1: 协议白名单：file/ftp/data 拒绝且不发请求，http/https 通过", async () => {
    const { runner } = makeRunner();
    const fetchFn = mock.fn(async () => fakeResponse({ body: "ok" }));

    for (const url of [
      "file:///etc/passwd",
      "ftp://x",
      "data:text/plain,x",
    ]) {
      await assert.rejects(
        runner.call("curl", { url }, makeCtx(fetchFn as unknown as typeof fetch)),
        (err: unknown) => {
          assert.ok(err instanceof ToolError);
          assert.equal(err.code, "INVALID_ARGUMENT");
          return true;
        },
      );
    }
    assert.equal(fetchFn.mock.callCount(), 0);

    const out = await runner.call(
      "curl",
      { url: "http://example.com/a" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
      ),
    );
    assert.equal((out as { status: number }).status, 200);
    const outHttps = await runner.call(
      "curl",
      { url: "https://example.com/b" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
      ),
    );
    assert.equal((outHttps as { status: number }).status, 200);
  });

  it("T-CT2: 成功响应各字段回填（url/finalUrl/method/status/contentType/body/truncated/originalBytes），method 默认 GET", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "curl",
      { url: "https://example.com/docs" },
      makeCtx(
        mock.fn(async () =>
          fakeResponse({
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            body: "hello world",
          }),
        ) as unknown as typeof fetch,
      ),
    );
    const rec = out as {
      url: string;
      finalUrl: string;
      method: string;
      status: number;
      contentType: string;
      body: string;
      truncated: boolean;
      originalBytes: number;
    };
    assert.equal(rec.url, "https://example.com/docs");
    // mock Response 无重定向信息（response.url 空串）→ finalUrl 回填请求 URL。
    assert.equal(rec.finalUrl, "https://example.com/docs");
    assert.equal(rec.method, "GET");
    assert.equal(rec.status, 200);
    assert.equal(rec.contentType, "text/html; charset=utf-8");
    assert.equal(rec.body, "hello world");
    assert.equal(rec.truncated, false);
    assert.equal(rec.originalBytes, 11);
  });

  it("T-CT3: 超预算正文按字节截断并附标注行（ASCII 与多字节两路）", async () => {
    const { runner } = makeRunner();
    // 300KB ASCII 正文 > 256KB 预算（curl 升级后预算从 50KB 提到 256KB）。
    const ascii = "a".repeat(300_000);
    const out = await runner.call(
      "curl",
      { url: "https://example.com/big" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: ascii })) as unknown as typeof fetch,
      ),
    );
    const rec = out as { body: string; truncated: boolean; originalBytes: number };
    assert.equal(rec.truncated, true);
    assert.equal(rec.originalBytes, 300_000);
    assert.ok(
      rec.body.endsWith("Output truncated (original 300000 bytes)."),
      `body 应以截断标注结尾: ${rec.body.slice(-60)}`,
    );
    const kept = rec.body.slice(
      0,
      rec.body.indexOf("\n\nOutput truncated"),
    );
    // 标注行不计入预算：截断后的正文部分 ≤ CURL_MAX_BODY_BYTES。
    assert.ok(
      new TextEncoder().encode(kept).byteLength <= CURL_MAX_BODY_BYTES,
    );
    assert.equal(kept, "a".repeat(kept.length));

    // 多字节：中文字符 3 字节/字符，按字符数切会失守字节预算，且不得切半个字符。
    // 90_000 字中文 = 270_000 字节 > 262_144 预算。
    const cjk = "你".repeat(90_000);
    const out2 = await runner.call(
      "curl",
      { url: "https://example.com/cjk" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: cjk })) as unknown as typeof fetch,
      ),
    );
    const rec2 = out2 as typeof rec;
    assert.equal(rec2.truncated, true);
    assert.equal(rec2.originalBytes, 270_000);
    const kept2 = rec2.body.slice(
      0,
      rec2.body.indexOf("\n\nOutput truncated"),
    );
    const kept2Bytes = new TextEncoder().encode(kept2).byteLength;
    assert.ok(kept2Bytes <= CURL_MAX_BODY_BYTES);
    assert.ok(kept2Bytes % 3 === 0, "截断不应切在多字节字符中间");
    assert.ok(kept2.length > 0);
  });

  it("T-CT4: 超时（默认 30s）→ ToolError FAILED，文案含 timed out 与 URL", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { runner } = makeRunner();
    const fetchFn = mock.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // 模拟 undici：监听 signal，收到 abort 后 reject AbortError。
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const pending = runner
      .call("curl", { url: "https://example.com/slow" }, makeCtx(fetchFn))
      .then(
        () => assert.fail("超时应抛 ToolError"),
        (err: unknown) => err,
      );
    // flush 微任务：让 run 进入 fetch、abort listener 已挂好。
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(30_000);

    const err = await pending;
    assert.ok(err instanceof ToolError);
    assert.equal(err.code, "FAILED");
    const message = formatToolErrorForLlm(err);
    assert.match(message, /timed out/);
    assert.match(message, /https:\/\/example\.com\/slow/);
  });

  it("T-CT14: body 下载阶段慢滴流挂起 → 超时中断，不无限挂起回合", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { runner } = makeRunner();
    const fetchFn = mock.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          // 响应头立即返回，body 永不完成：text() 监听 signal，
          // abort 时 reject AbortError（模拟 undici 慢滴流 body 的中断）。
          fakeResponse({
            headers: { "content-type": "text/html" },
            pendingBodySignal: init?.signal,
          }),
        ),
    ) as unknown as typeof fetch;

    const pending = runner
      .call(
        "curl",
        { url: "https://example.com/slow-body" },
        makeCtx(fetchFn),
      )
      .then(
        () => assert.fail("慢 body 应超时抛 ToolError"),
        (err: unknown) => err,
      );
    // flush 微任务：让 run 拿到响应头并进入 text()，abort listener 已挂好。
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(30_000);

    const err = await pending;
    assert.ok(err instanceof ToolError);
    assert.equal(err.code, "FAILED");
    const message = formatToolErrorForLlm(err);
    assert.match(message, /timed out/);
    assert.match(message, /https:\/\/example\.com\/slow-body/);
  });

  it("T-CT5: 网络错误 → ToolError FAILED 且 cause 文案可读", async () => {
    const { runner } = makeRunner();
    const err = await runner
      .call(
        "curl",
        { url: "https://example.com/down" },
        makeCtx(
          mock.fn(() =>
            Promise.reject(new TypeError("Network request failed")),
          ) as unknown as typeof fetch,
        ),
      )
      .then(
        () => assert.fail("网络错误应抛 ToolError"),
        (e: unknown) => e,
      );
    assert.ok(err instanceof ToolError);
    assert.equal(err.code, "FAILED");
    assert.match(formatToolErrorForLlm(err), /Network request failed/);
  });

  it("T-CT6: HTTP 404 不是错误：照常返回输出（status=404，body 照常处理）", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "curl",
      { url: "https://example.com/missing" },
      makeCtx(
        mock.fn(async () =>
          fakeResponse({
            status: 404,
            headers: { "content-type": "text/html" },
            body: "not found page",
          }),
        ) as unknown as typeof fetch,
      ),
    );
    const rec = out as { status: number; body: string; truncated: boolean };
    assert.equal(rec.status, 404);
    assert.equal(rec.body, "not found page");
    assert.equal(rec.truncated, false);
  });

  it("T-CT7: 非文本 Content-Type → 不读 body，占位说明回填 content-length", async () => {
    const { runner } = makeRunner();
    const response = fakeResponse({
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
      body: "\u0000\u0001\u0002\u0003",
    });
    const out = await runner.call(
      "curl",
      { url: "https://example.com/logo.png" },
      makeCtx(
        mock.fn(async () => response) as unknown as typeof fetch,
      ),
    );
    const rec = out as {
      body: string;
      truncated: boolean;
      originalBytes: number;
    };
    // contentType 响应头阶段即已知：不应为了丢弃而先全量下载正文。
    assert.equal(response.textCalls(), 0, "非文本路径不应读 body");
    assert.equal(rec.body, `[binary content, 4 bytes, not shown]`);
    assert.equal(rec.originalBytes, 4);
    assert.equal(rec.truncated, false);

    // content-length 缺失：体积标 unknown，originalBytes 置 0。
    const noLength = fakeResponse({
      headers: { "content-type": "image/png" },
      body: "\u0000\u0001",
    });
    const out2 = await runner.call(
      "curl",
      { url: "https://example.com/no-len.png" },
      makeCtx(
        mock.fn(async () => noLength) as unknown as typeof fetch,
      ),
    );
    const rec2 = out2 as { body: string; originalBytes: number };
    assert.equal(noLength.textCalls(), 0);
    assert.equal(rec2.body, `[binary content, unknown size, not shown]`);
    assert.equal(rec2.originalBytes, 0);
  });

  it("T-CT8: 重定向 → finalUrl 回填且 formatter 输出 curl METHOD url → finalUrl", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "curl",
      { url: "https://example.com/old" },
      makeCtx(
        mock.fn(async () =>
          fakeResponse({
            url: "https://example.com/new",
            headers: { "content-type": "text/html" },
            body: "moved",
          }),
        ) as unknown as typeof fetch,
      ),
    );
    const rec = out as { url: string; finalUrl: string };
    assert.equal(rec.url, "https://example.com/old");
    assert.equal(rec.finalUrl, "https://example.com/new");
    const formatted = formatToolOutputForLlm(out);
    assert.ok(formatted.includes("curl GET https://example.com/old → https://example.com/new"));
    assert.ok(formatted.includes("moved"));
  });

  it("T-CT9: content-length 预检：声明超上限时不读 body，originalBytes 回填头数值", async () => {
    const { runner } = makeRunner();
    const declared = 11 * 1024 * 1024;
    const response = fakeResponse({
      headers: {
        "content-length": String(declared),
        "content-type": "application/octet-stream",
      },
      body: "should not be read",
    });
    const out = await runner.call(
      "curl",
      { url: "https://example.com/huge" },
      makeCtx(
        mock.fn(async () => response) as unknown as typeof fetch,
      ),
    );
    const rec = out as {
      body: string;
      truncated: boolean;
      originalBytes: number;
    };
    assert.equal(response.textCalls(), 0, "预检路径不应读 body");
    assert.equal(rec.truncated, true);
    assert.equal(rec.originalBytes, declared);
    assert.ok(rec.body.includes("not downloaded"));
    assert.ok(
      rec.body.includes(`Output truncated (original ${declared} bytes).`),
    );
  });

  it("T-CT10: formatter 产出可读文本（非 JSON 串），截断场景含标注行", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "curl",
      { url: "https://example.com/big" },
      makeCtx(
        mock.fn(async () =>
          fakeResponse({ body: "b".repeat(300_000) }),
        ) as unknown as typeof fetch,
      ),
    );
    const formatted = formatToolOutputForLlm(out);
    assert.ok(!formatted.trimStart().startsWith("{"), "不应回落 JSON.stringify");
    assert.ok(formatted.startsWith("curl GET https://example.com/big"));
    assert.ok(formatted.includes("Status: 200"));
    assert.ok(formatted.includes("Output truncated (original 300000 bytes)."));
  });

  it("T-CT10 回归: curl 输出形状不误撞 read/grep/glob/fs 形状", () => {
    const curlOut = {
      url: "https://example.com",
      finalUrl: "https://example.com",
      method: "GET",
      status: 200,
      contentType: "text/html",
      body: "x",
      truncated: false,
      originalBytes: 1,
    };
    assert.equal(isCurlOutput(curlOut), true);
    assert.equal(isReadOutput(curlOut), false);
    assert.equal(isGrepOutput(curlOut), false);
    assert.equal(isGlobOutput(curlOut), false);

    // 反向：read 输出也不会被 isCurlOutput 误撞（无 url+status 字段）。
    const readOut = {
      path: "/a.md",
      content: "line-1",
      totalLines: 1,
      returnedLines: 1,
      truncated: false,
    };
    assert.equal(isCurlOutput(readOut), false);
  });

  it("T-CT11: buildToolResultBlock 摘要——正常 `200 · 12.3KB`、截断 `truncated · 256KB/1.2MB`", () => {
    const normal = buildToolResultBlock(
      "tu-normal",
      {
        ok: true,
        output: {
          url: "https://example.com",
          finalUrl: "https://example.com",
          method: "GET",
          status: 200,
          contentType: "text/html",
          body: "x",
          truncated: false,
          originalBytes: 12_646,
        },
      },
      { toolName: "curl" },
    );
    assert.equal(normal.summary, "200 · 12.3KB");
    assert.ok(normal.content.startsWith("curl GET https://example.com"));

    const truncated = buildToolResultBlock(
      "tu-trunc",
      {
        ok: true,
        output: {
          url: "https://example.com",
          finalUrl: "https://example.com",
          method: "GET",
          status: 200,
          contentType: "text/html",
          body: "x".repeat(300_000),
          truncated: true,
          originalBytes: 1_258_291,
        },
      },
      { toolName: "curl" },
    );
    // body 300_000 字节 > 256KB 预算 → 保留量按预算值口径展示 256KB。
    assert.equal(truncated.summary, "truncated · 256KB/1.2MB");

    // 字节格式化规则抽查：1024 进位、保留 1 位小数。
    assert.equal(
      buildToolResultBlock("tu-b", {
        ok: true,
        output: {
          url: "u",
          finalUrl: "u",
          method: "GET",
          status: 301,
          contentType: "",
          body: "x",
          truncated: false,
          originalBytes: 512,
        },
      }, { toolName: "curl" }).summary,
      "301 · 512B",
    );
  });

  it("T-CT12: 注册与策略——deny 摘除、孙 agent（depth>=2）不摘", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.ok(registry.list().includes("curl"));
    assert.ok(registry.list().includes(curlTool.name));

    const def: AgentDefinition = {
      name: "x",
      prompts: { persist: [], dynamic: [] },
    };

    const denied = resolveAgentToolRegistry(registry, {
      ...def,
      tools: { deny: ["curl"] },
    });
    assert.ok(!denied.list().includes("curl"));

    const grandchild = resolveAgentToolRegistry(registry, def, { depth: 2 });
    assert.ok(grandchild.list().includes("curl"));
    // 对照：孙 agent 摘 task / agent。
    assert.ok(!grandchild.list().includes("task"));
    assert.ok(!grandchild.list().includes("agent"));
  });

  it("T-CT13: path policy 不误伤——入参顶层字段 url 不在 PATH_FIELDS", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "curl",
      { url: "https://example.com" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
        { allowedPaths: ["src/"] },
      ),
    );
    assert.equal((out as { body: string }).body, "ok");
  });

  it("T-CT15: method/headers/body 透传——显式 content-type 尊重，有 body 未给时默认 application/json", async () => {
    const { runner } = makeRunner();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Promise.resolve(
          fakeResponse({ headers: { "content-type": "application/json" }, body: "{}" }),
        );
      },
    ) as unknown as typeof fetch;

    // POST + 自定义鉴权头 + body 未给 content-type → 默认 application/json。
    await runner.call(
      "curl",
      {
        url: "https://api.example.com/items",
        method: "POST",
        headers: { authorization: "Bearer t0k3n" },
        body: JSON.stringify({ name: "x" }),
      },
      makeCtx(fetchFn),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.body, JSON.stringify({ name: "x" }));
    const headers = calls[0]!.init.headers as Headers;
    assert.equal(headers.get("authorization"), "Bearer t0k3n");
    assert.equal(headers.get("content-type"), "application/json");

    // POST + 显式 content-type → 尊重显式值，不覆盖。
    await runner.call(
      "curl",
      {
        url: "https://api.example.com/items",
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "raw text",
      },
      makeCtx(fetchFn),
    );
    assert.equal(
      (calls[1]!.init.headers as Headers).get("content-type"),
      "text/plain",
    );

    // 默认 GET 无 body → 不带 body、不补 content-type。
    await runner.call(
      "curl",
      { url: "https://api.example.com/items" },
      makeCtx(fetchFn),
    );
    assert.equal(calls[2]!.init.method, "GET");
    assert.equal(calls[2]!.init.body, undefined);
    assert.equal(
      (calls[2]!.init.headers as Headers).get("content-type"),
      null,
    );

    // 输出回显实际 method。
    const out = await runner.call(
      "curl",
      {
        url: "https://api.example.com/items",
        method: "DELETE",
      },
      makeCtx(fetchFn),
    );
    assert.equal((out as { method: string }).method, "DELETE");
  });

  it("T-CT16: 参数校验——headers/body/timeout 非法入参 schema 层拒绝且不发请求", async () => {
    const { runner } = makeRunner();
    const fetchFn = mock.fn(async () => fakeResponse({ body: "ok" }));
    const ctx = makeCtx(fetchFn as unknown as typeof fetch);

    const tooManyHeaders: Record<string, string> = {};
    for (let i = 0; i < 17; i += 1) tooManyHeaders[`x-h-${i}`] = "v";

    const invalidInputs: ReadonlyArray<Record<string, unknown>> = [
      { url: "https://example.com", headers: tooManyHeaders },
      // header 名混入空格 / 冒号 / CR：防 CRLF 注入白名单拒绝。
      { url: "https://example.com", headers: { "Bad Header": "v" } },
      { url: "https://example.com", headers: { "a:b": "v" } },
      { url: "https://example.com", headers: { "a\rX-Evil: 1": "v" } },
      // 值含 CRLF：报可读错误。
      { url: "https://example.com", headers: { "x-h": "v\r\nX-Evil: 1" } },
      // 单条值超 8KB。
      {
        url: "https://example.com",
        headers: { "x-h": "v".repeat(8 * 1024 + 1) },
      },
      // body 超 1MB。
      { url: "https://example.com", method: "POST", body: "b".repeat(1024 * 1024 + 1) },
      // GET / HEAD 不允许携带 body。
      { url: "https://example.com", method: "GET", body: "x" },
      { url: "https://example.com", method: "HEAD", body: "x" },
      // timeout 超上限 / 非整数。
      { url: "https://example.com", timeout: 121 },
      { url: "https://example.com", timeout: 1.5 },
    ];

    for (const input of invalidInputs) {
      await assert.rejects(
        runner.call("curl", input, ctx),
        (err: unknown) => {
          assert.ok(err instanceof ToolError, `应抛 ToolError: ${JSON.stringify(Object.keys(input))}`);
          assert.equal(err.code, "INVALID_ARGUMENT");
          return true;
        },
      );
    }
    assert.equal(fetchFn.mock.callCount(), 0, "非法入参不应发起请求");
  });

  it("T-CT17: timeout 参数驱动超时——自定义 2 秒到点中断且文案含实际毫秒", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { runner } = makeRunner();
    const fetchFn = mock.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const pending = runner
      .call(
        "curl",
        { url: "https://example.com/slow", timeout: 2 },
        makeCtx(fetchFn),
      )
      .then(
        () => assert.fail("超时应抛 ToolError"),
        (err: unknown) => err,
      );
    await new Promise((resolve) => setImmediate(resolve));
    // 推进 2 秒（默认 30 秒未到）：参数驱动的超时应在 2s 到点即中断。
    mock.timers.tick(2_000);

    const err = await pending;
    assert.ok(err instanceof ToolError);
    assert.equal(err.code, "FAILED");
    const message = formatToolErrorForLlm(err);
    assert.match(message, /timed out after 2000ms/);
    assert.match(message, /https:\/\/example\.com\/slow/);
  });
});
