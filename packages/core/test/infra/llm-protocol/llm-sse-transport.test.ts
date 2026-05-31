import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  postSse,
  resetShouldUseXhrForSseCacheForTests,
  setShouldUseXhrForSseOverrideForTests,
  shouldUseXhrForSse,
} from "../../../src/infra/llm-protocol/logic/llm-sse-transport.js";

afterEach(() => {
  resetShouldUseXhrForSseCacheForTests();
});

describe("llm-sse-transport", () => {
  it("TRANS-01: fetch path delivers multiple onChunk calls", async () => {
    setShouldUseXhrForSseOverrideForTests(false);

    const ssePart1 = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\n';
    const ssePart2 = 'data: {"choices":[{"delta":{"content":"B"}}]}\n\n';
    const encoder = new TextEncoder();

    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(ssePart1));
          controller.enqueue(encoder.encode(ssePart2));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const chunks: string[] = [];
    const result = await postSse(
      "https://api.example.com/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
        body: "{}",
      },
      (chunk) => chunks.push(chunk),
      undefined,
      { fetchFn: fetchFn as typeof fetch },
    );

    assert.equal(result.status, 200);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.includes('"content":"A"'));
    assert.ok(chunks[1]!.includes('"content":"B"'));
  });

  it("TRANS-02: XHR onprogress delivers incremental chunks", async () => {
    setShouldUseXhrForSseOverrideForTests(true);

    type XhrInstance = {
      open: ReturnType<typeof mock.fn>;
      setRequestHeader: ReturnType<typeof mock.fn>;
      send: ReturnType<typeof mock.fn>;
      onprogress: (() => void) | null;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      responseText: string;
      status: number;
      getResponseHeader: (name: string) => string | null;
    };

    let lastXhr: XhrInstance | undefined;

    class MockXMLHttpRequest {
      open = mock.fn();
      setRequestHeader = mock.fn();
      send = mock.fn(() => {
        lastXhr!.responseText = 'data: {"x":1}\n\n';
        lastXhr!.onprogress?.();
        lastXhr!.responseText += 'data: {"x":2}\n\n';
        lastXhr!.onprogress?.();
        lastXhr!.status = 200;
        lastXhr!.onload?.();
      });
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      responseText = "";
      status = 0;
      getResponseHeader = mock.fn(() => "text/event-stream");

      constructor() {
        lastXhr = this;
      }
    }

    const origXhr = globalThis.XMLHttpRequest;
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      MockXMLHttpRequest as unknown as typeof XMLHttpRequest;

    try {
      const chunks: string[] = [];
      await postSse(
        "https://api.example.com/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: "Bearer sk-test" },
          body: "{}",
        },
        (chunk) => chunks.push(chunk),
      );

      assert.equal(chunks.length, 2);
      assert.ok(chunks[0]!.includes('"x":1'));
      assert.ok(chunks[1]!.includes('"x":2'));
      assert.equal(lastXhr!.open.mock.calls[0]?.arguments[0], "POST");
    } finally {
      (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
        origXhr;
    }
  });

  it("TRANS-03b: XHR HTTP 401 throws ProviderError", async () => {
    setShouldUseXhrForSseOverrideForTests(true);

    class MockXMLHttpRequest {
      open = mock.fn();
      setRequestHeader = mock.fn();
      send = mock.fn(function (this: MockXMLHttpRequest) {
        this.responseText = "Unauthorized";
        this.status = 401;
        this.onload?.();
      });
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      responseText = "";
      status = 0;
      getResponseHeader = mock.fn(() => "application/json");
    }

    const origXhr = globalThis.XMLHttpRequest;
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      MockXMLHttpRequest as unknown as typeof XMLHttpRequest;

    try {
      await assert.rejects(
        () =>
          postSse(
            "https://api.example.com/v1/chat/completions",
            { method: "POST", body: "{}" },
            () => {},
            "openai-test",
          ),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, "HTTP_ERROR");
          assert.match(String(err.message), /401/);
          return true;
        },
      );
    } finally {
      (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
        origXhr;
    }
  });

  it("TRANS-03: HTTP 401 throws ProviderError", async () => {
    setShouldUseXhrForSseOverrideForTests(false);

    const fetchFn = mock.fn(async () => {
      return new Response("Unauthorized", { status: 401 });
    });

    await assert.rejects(
      () =>
        postSse(
          "https://api.example.com/v1/chat/completions",
          { method: "POST", body: "{}" },
          () => {},
          "openai-test",
          { fetchFn: fetchFn as typeof fetch },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "HTTP_ERROR");
        assert.match(String(err.message), /401/);
        return true;
      },
    );
  });

  it("TRANS-04: React Native navigator uses XHR not fetch", async () => {
    const origNav = globalThis.navigator;
    const origXhr = globalThis.XMLHttpRequest;

    class MockXMLHttpRequest {
      open = mock.fn();
      setRequestHeader = mock.fn();
      send = mock.fn(function (this: MockXMLHttpRequest) {
        this.responseText = "data: ok\n\n";
        this.status = 200;
        this.onload?.();
      });
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      responseText = "";
      status = 0;
      getResponseHeader = mock.fn(() => "text/event-stream");
    }

    Object.defineProperty(globalThis, "navigator", {
      value: { product: "ReactNative" },
      configurable: true,
      writable: true,
    });
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      MockXMLHttpRequest as unknown as typeof XMLHttpRequest;

    resetShouldUseXhrForSseCacheForTests();
    assert.equal(shouldUseXhrForSse(), true);

    const fetchFn = mock.fn(async () => {
      throw new Error("fetch must not be called on React Native");
    });

    try {
      const chunks: string[] = [];
      await postSse(
        "https://api.example.com/v1/chat/completions",
        { method: "POST", body: "{}" },
        (chunk) => chunks.push(chunk),
        undefined,
        { fetchFn: fetchFn as typeof fetch },
      );

      assert.equal(fetchFn.mock.calls.length, 0);
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0]!.includes("ok"));
    } finally {
      if (origNav === undefined) {
        Reflect.deleteProperty(globalThis, "navigator");
      } else {
        Object.defineProperty(globalThis, "navigator", {
          value: origNav,
          configurable: true,
          writable: true,
        });
      }
      (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
        origXhr;
      resetShouldUseXhrForSseCacheForTests();
    }
  });

  it("fetch path throws when response body is null", async () => {
    setShouldUseXhrForSseOverrideForTests(false);

    const fetchFn = mock.fn(async () => {
      return new Response(null, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    await assert.rejects(
      () =>
        postSse(
          "https://api.example.com/v1/chat/completions",
          { method: "POST", body: "{}" },
          () => {},
          undefined,
          { fetchFn: fetchFn as typeof fetch },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "HTTP_ERROR");
        assert.match(String(err.message), /does not support fetch stream bodies/);
        return true;
      },
    );
  });
});
