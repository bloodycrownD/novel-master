import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { addLogSink, createLogger, restoreDefaultLogSink, setDefaultLogSink } from "@novel-master/core/log";
import type { LogRecord, LogSink } from "@novel-master/core/log";

/** 捕获 sink：spec 约定的测试范式——不新增 test-only 导出，靠公开 API 捕获。 */
function captureSink(): { readonly records: LogRecord[]; readonly sink: LogSink } {
  const records: LogRecord[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

/** 捕获 console.warn 调用（A3 / A5 验证内置 sink 在位与摘除）。 */
function captureConsoleWarn<T>(fn: () => T): { result: T; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    return { result: fn(), calls };
  } finally {
    console.warn = original;
  }
}

afterEach(() => {
  restoreDefaultLogSink();
});

describe("createLogger", () => {
  it("A2: child 把 scope 拼成 `${parent}.${child}`", () => {
    assert.equal(createLogger("a").child("b").scope, "a.b");
    assert.equal(createLogger("a").child("b").child("c").scope, "a.b.c");
    assert.equal(createLogger("agent.runner").scope, "agent.runner");
  });

  it("A2: child 记录带拼接后的 scope 与级别", () => {
    const { records, sink } = captureSink();
    setDefaultLogSink(sink);
    createLogger("a").child("b").warn("hello");
    assert.equal(records.length, 1);
    assert.equal(records[0]!.scope, "a.b");
    assert.equal(records[0]!.level, "warn");
    assert.equal(records[0]!.message, "hello");
    assert.equal(records[0]!.detail, undefined);
    assert.equal(typeof records[0]!.ts, "number");
  });

  it("A3: 默认内置 console sink 在位——warn 会走到 console.warn", () => {
    const { calls } = captureConsoleWarn(() => {
      createLogger("unit").warn("boom");
    });
    assert.equal(calls.length, 1);
    assert.match(String(calls[0]![0]), /boom/);
    assert.match(String(calls[0]![0]), /unit/);
  });

  it("A4: addLogSink 追加不替换——console 与注入 sink 都收到同一条", () => {
    const { records, sink } = captureSink();
    const remove = addLogSink(sink);
    try {
      const { calls } = captureConsoleWarn(() => {
        createLogger("unit").warn("both");
      });
      assert.equal(records.length, 1);
      assert.equal(calls.length, 1);
      assert.equal(records[0]!.message, "both");
      assert.equal(records[0]!.scope, "unit");
    } finally {
      remove();
    }
  });

  it("A4: addLogSink 返回的摘除函数生效", () => {
    const { records, sink } = captureSink();
    const remove = addLogSink(sink);
    remove();
    captureConsoleWarn(() => {
      createLogger("unit").info("after-remove");
    });
    assert.equal(records.length, 0);
  });

  it("A5: setDefaultLogSink(null) 关内置输出、已追加 sink 仍在；restore 后 console 恢复", () => {
    const { records, sink } = captureSink();
    const remove = addLogSink(sink);
    try {
      setDefaultLogSink(null);
      const muted = captureConsoleWarn(() => {
        createLogger("unit").warn("muted");
      });
      assert.equal(muted.calls.length, 0, "内置 sink 关闭后 console 不应收到");
      assert.equal(records.length, 1, "已追加 sink 不受 setDefaultLogSink 影响");

      restoreDefaultLogSink();
      const restored = captureConsoleWarn(() => {
        createLogger("unit").warn("restored");
      });
      assert.equal(restored.calls.length, 1, "restore 后 console 恢复接收");
      assert.equal(records.length, 2);
    } finally {
      remove();
    }
  });

  it("A6: sink 抛错不外溢——log.error 不抛，且不影响后续 sink", () => {
    const { records, sink } = captureSink();
    setDefaultLogSink(null);
    const removeThrower = addLogSink({
      write() {
        throw new Error("sink boom");
      },
    });
    const removeTail = addLogSink(sink);
    try {
      assert.doesNotThrow(() => {
        createLogger("unit").error("business-as-usual");
      });
      assert.equal(records.length, 1, "抛错 sink 之后追加的 sink 仍应收到记录");
    } finally {
      removeThrower();
      removeTail();
    }
  });

  it("A6: sink 内部再调 logger 不会无限递归", () => {
    const records: LogRecord[] = [];
    setDefaultLogSink(null);
    const removeReentrant = addLogSink({
      write(record) {
        createLogger("reentrant").warn("nested");
        records.push(record);
      },
    });
    try {
      assert.doesNotThrow(() => {
        createLogger("unit").warn("outer");
      });
      // 重入的 nested 被防重入标志丢弃，只留下外层记录。
      assert.deepEqual(records.map((record) => record.message), ["outer"]);
    } finally {
      removeReentrant();
    }
  });
});
