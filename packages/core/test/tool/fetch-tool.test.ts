import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import {
  FETCH_MAX_BODY_BYTES,
  fetchTool,
} from "../../src/domain/tool/builtin/fetch-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
  isFetchOutput,
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

describe("fetch 工具", () => {
  it("T-FT1: 协议白名单：file/ftp/data 拒绝且不发请求，http/https 通过", async () => {
    const { runner } = makeRunner();
    const fetchFn = mock.fn(async () => fakeResponse({ body: "ok" }));

    for (const url of [
      "file:///etc/passwd",
      "ftp://x",
      "data:text/plain,x",
    ]) {
      await assert.rejects(
        runner.call("fetch", { url }, makeCtx(fetchFn as unknown as typeof fetch)),
        (err: unknown) => {
          assert.ok(err instanceof ToolError);
          assert.equal(err.code, "INVALID_ARGUMENT");
          return true;
        },
      );
    }
    assert.equal(fetchFn.mock.callCount(), 0);

    const out = await runner.call(
      "fetch",
      { url: "http://example.com/a" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
      ),
    );
    assert.equal((out as { status: number }).status, 200);
    const outHttps = await runner.call(
      "fetch",
      { url: "https://example.com/b" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
      ),
    );
    assert.equal((outHttps as { status: number }).status, 200);
  });

  it("T-FT2: 成功响应各字段回填（url/finalUrl/status/contentType/body/truncated/originalBytes）", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "fetch",
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
      status: number;
      contentType: string;
      body: string;
      truncated: boolean;
      originalBytes: number;
    };
    assert.equal(rec.url, "https://example.com/docs");
    // mock Response 无重定向信息（response.url 空串）→ finalUrl 回填请求 URL。
    assert.equal(rec.finalUrl, "https://example.com/docs");
    assert.equal(rec.status, 200);
    assert.equal(rec.contentType, "text/html; charset=utf-8");
    assert.equal(rec.body, "hello world");
    assert.equal(rec.truncated, false);
    assert.equal(rec.originalBytes, 11);
  });

  it("T-FT3: 超预算正文按字节截断并附标注行（ASCII 与多字节两路）", async () => {
    const { runner } = makeRunner();
    const ascii = "a".repeat(60_000);
    const out = await runner.call(
      "fetch",
      { url: "https://example.com/big" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: ascii })) as unknown as typeof fetch,
      ),
    );
    const rec = out as { body: string; truncated: boolean; originalBytes: number };
    assert.equal(rec.truncated, true);
    assert.equal(rec.originalBytes, 60_000);
    assert.ok(
      rec.body.endsWith("Output truncated (original 60000 bytes)."),
      `body 应以截断标注结尾: ${rec.body.slice(-60)}`,
    );
    const kept = rec.body.slice(
      0,
      rec.body.indexOf("\n\nOutput truncated"),
    );
    // 标注行不计入预算：截断后的正文部分 ≤ FETCH_MAX_BODY_BYTES。
    assert.ok(
      new TextEncoder().encode(kept).byteLength <= FETCH_MAX_BODY_BYTES,
    );
    assert.equal(kept, "a".repeat(kept.length));

    // 多字节：中文字符 3 字节/字符，按字符数切会失守字节预算，且不得切半个字符。
    const cjk = "你".repeat(20_000);
    const out2 = await runner.call(
      "fetch",
      { url: "https://example.com/cjk" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: cjk })) as unknown as typeof fetch,
      ),
    );
    const rec2 = out2 as typeof rec;
    assert.equal(rec2.truncated, true);
    assert.equal(rec2.originalBytes, 60_000);
    const kept2 = rec2.body.slice(
      0,
      rec2.body.indexOf("\n\nOutput truncated"),
    );
    const kept2Bytes = new TextEncoder().encode(kept2).byteLength;
    assert.ok(kept2Bytes <= FETCH_MAX_BODY_BYTES);
    assert.ok(kept2Bytes % 3 === 0, "截断不应切在多字节字符中间");
    assert.ok(kept2.length > 0);
  });

  it("T-FT4: 超时 → ToolError FAILED，文案含 timed out 与 URL", async () => {
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
      .call("fetch", { url: "https://example.com/slow" }, makeCtx(fetchFn))
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

  it("T-FT14: body 下载阶段慢滴流挂起 → 超时中断，不无限挂起回合", async () => {
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
        "fetch",
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

  it("T-FT5: 网络错误 → ToolError FAILED 且 cause 文案可读", async () => {
    const { runner } = makeRunner();
    const err = await runner
      .call(
        "fetch",
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

  it("T-FT6: HTTP 404 不是错误：照常返回输出（status=404，body 照常处理）", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "fetch",
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

  it("T-FT7: 非文本 Content-Type → 不读 body，占位说明回填 content-length", async () => {
    const { runner } = makeRunner();
    const response = fakeResponse({
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
      body: "\u0000\u0001\u0002\u0003",
    });
    const out = await runner.call(
      "fetch",
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
      "fetch",
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

  it("T-FT8: 重定向 → finalUrl 回填且 formatter 输出 GET <url> → <finalUrl>", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "fetch",
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
    assert.ok(formatted.includes("GET https://example.com/old → https://example.com/new"));
    assert.ok(formatted.includes("moved"));
  });

  it("T-FT9: content-length 预检：声明超上限时不读 body，originalBytes 回填头数值", async () => {
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
      "fetch",
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

  it("T-FT10: formatter 产出可读文本（非 JSON 串），截断场景含标注行", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "fetch",
      { url: "https://example.com/big" },
      makeCtx(
        mock.fn(async () =>
          fakeResponse({ body: "b".repeat(60_000) }),
        ) as unknown as typeof fetch,
      ),
    );
    const formatted = formatToolOutputForLlm(out);
    assert.ok(!formatted.trimStart().startsWith("{"), "不应回落 JSON.stringify");
    assert.ok(formatted.startsWith("GET https://example.com/big"));
    assert.ok(formatted.includes("Status: 200"));
    assert.ok(formatted.includes("Output truncated (original 60000 bytes)."));
  });

  it("T-FT10 回归: fetch 输出形状不误撞 read/grep/glob/fs 形状", () => {
    const fetchOut = {
      url: "https://example.com",
      finalUrl: "https://example.com",
      status: 200,
      contentType: "text/html",
      body: "x",
      truncated: false,
      originalBytes: 1,
    };
    assert.equal(isFetchOutput(fetchOut), true);
    assert.equal(isReadOutput(fetchOut), false);
    assert.equal(isGrepOutput(fetchOut), false);
    assert.equal(isGlobOutput(fetchOut), false);

    // 反向：read 输出也不会被 isFetchOutput 误撞（无 url+status 字段）。
    const readOut = {
      path: "/a.md",
      content: "line-1",
      totalLines: 1,
      returnedLines: 1,
      truncated: false,
    };
    assert.equal(isFetchOutput(readOut), false);
  });

  it("T-FT11: buildToolResultBlock 摘要——正常 `200 · 12.3KB`、截断 `truncated · 50KB/1.2MB`", () => {
    const normal = buildToolResultBlock(
      "tu-normal",
      {
        ok: true,
        output: {
          url: "https://example.com",
          finalUrl: "https://example.com",
          status: 200,
          contentType: "text/html",
          body: "x",
          truncated: false,
          originalBytes: 12_646,
        },
      },
      { toolName: "fetch" },
    );
    assert.equal(normal.summary, "200 · 12.3KB");
    assert.ok(normal.content.startsWith("GET https://example.com"));

    const truncated = buildToolResultBlock(
      "tu-trunc",
      {
        ok: true,
        output: {
          url: "https://example.com",
          finalUrl: "https://example.com",
          status: 200,
          contentType: "text/html",
          body: "x".repeat(60_000),
          truncated: true,
          originalBytes: 1_258_291,
        },
      },
      { toolName: "fetch" },
    );
    assert.equal(truncated.summary, "truncated · 50KB/1.2MB");

    // 字节格式化规则抽查：1024 进位、保留 1 位小数。
    assert.equal(
      buildToolResultBlock("tu-b", {
        ok: true,
        output: {
          url: "u",
          finalUrl: "u",
          status: 301,
          contentType: "",
          body: "x",
          truncated: false,
          originalBytes: 512,
        },
      }, { toolName: "fetch" }).summary,
      "301 · 512B",
    );
  });

  it("T-FT12: 注册与策略——deny 摘除、孙 agent（depth>=2）不摘", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.ok(registry.list().includes("fetch"));
    assert.ok(registry.list().includes(fetchTool.name));

    const def: AgentDefinition = {
      name: "x",
      prompts: { persist: [], dynamic: [] },
    };

    const denied = resolveAgentToolRegistry(registry, {
      ...def,
      tools: { deny: ["fetch"] },
    });
    assert.ok(!denied.list().includes("fetch"));

    const grandchild = resolveAgentToolRegistry(registry, def, { depth: 2 });
    assert.ok(grandchild.list().includes("fetch"));
    // 对照：孙 agent 摘 task / agent。
    assert.ok(!grandchild.list().includes("task"));
    assert.ok(!grandchild.list().includes("agent"));
  });

  it("T-FT13: path policy 不误伤——入参顶层字段 url 不在 PATH_FIELDS", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      "fetch",
      { url: "https://example.com" },
      makeCtx(
        mock.fn(async () => fakeResponse({ body: "ok" })) as unknown as typeof fetch,
        { allowedPaths: ["src/"] },
      ),
    );
    assert.equal((out as { body: string }).body, "ok");
  });
});
