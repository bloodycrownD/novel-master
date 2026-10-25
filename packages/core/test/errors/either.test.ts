/**
 * either.ts 单测（对象风格）：构造收窄 / 链式组合 / attempt 桥接 / 序列化往返 / toError 归一。
 *
 * 牙齿说明：
 * - 「error 保持原对象」对齐 storage-failure-bypass 的既定原则——端上错误分类
 *   依赖 XxxError.code，Result.err / Result.attempt* / Err 短路方法一旦复制或
 *   包装就会把 code 丢掉；链式短路返回 this，链上同样不得换壳。
 * - 序列化往返：JSON.stringify 会把裸 Error 序列化成 `{}`（message/name 都丢），
 *   toJSON 的存在使错误字段完整过线，revive 后 `isVfsError` 结构守卫必须照常
 *   可用——按旧实现（无 toJSON）本组必红。
 * - 「桥接层从不重抛」是通用性契约：域错误、基础设施故障、字符串抛出物都必须
 *   落进 Err——谁把 catch 里的 throw 写回去，本组立刻变红。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Result, type ResultWire } from "../../src/errors/either.js";
import { isVfsError, vfsNotFound } from "../../src/errors/vfs-errors.js";

describe("either 对象风格：构造与分支收窄", () => {
  it("r.ok 字段收窄后可安全取 value/error", () => {
    const good: Result<number, Error> = Result.ok(1);
    if (good.ok) {
      assert.equal(good.value, 1);
    } else {
      assert.fail("Result.ok 不得落入失败分支");
    }

    const bad: Result<number, Error> = Result.err(new Error("boom"));
    if (!bad.ok) {
      assert.equal(bad.error.message, "boom");
    } else {
      assert.fail("Result.err 不得落入成功分支");
    }
  });

  it("Result.err 保持传入对象本身（不包装不复制，code 依赖原对象）", () => {
    const cause = vfsNotFound("/docs/a.md");
    const r = Result.err(cause);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.error, cause, "error 必须是原对象，包装会丢掉 VfsError.code");
      assert.equal(r.error.code, "NOT_FOUND");
    }
  });
});

describe("either 对象风格：链式组合", () => {
  it("ok 侧链式推断完整", () => {
    const out = Result.ok(1)
      .map((n) => n + 1)
      .andThen((n) => Result.ok(String(n)))
      .unwrapOr("x");
    assert.equal(out, "2");
  });

  it("err 侧短路：fn 不被调用，链上不换壳", () => {
    const cause = new Error("skip");
    let called = false;
    const bad: Result<number, Error> = Result.err(cause);
    const out = bad
      .map((n) => {
        called = true;
        return n + 1;
      })
      .andThen((n) => {
        called = true;
        return Result.ok(n);
      });
    assert.equal(called, false, "失败分支必须短路，fn 不得执行");
    assert.ok(!out.ok);
    if (!out.ok) {
      assert.equal(out.error, cause, "短路方法返回 this，链上 error 不得换壳");
    }
  });

  it("mapErr 变换错误；orElse 失败补救、成功透传", () => {
    const bad: Result<number, Error> = Result.err(new Error("a"));
    const mapped = bad.mapErr((e) => new Error(`wrapped:${e.message}`));
    assert.ok(!mapped.ok);
    if (!mapped.ok) {
      assert.equal(mapped.error.message, "wrapped:a");
    }

    const failed: Result<number, string> = Result.err("abc");
    assert.equal(failed.orElse((e) => Result.ok(e.length)).unwrapOr(-1), 3);

    const good: Result<number, string> = Result.ok(7);
    let rescued = false;
    const kept = good.orElse(() => {
      rescued = true;
      return Result.ok(-1);
    });
    assert.equal(rescued, false, "成功分支不得触发补救");
    assert.equal(kept.unwrapOr(-1), 7);
  });

  it("match / unwrapOrElse 双分支", () => {
    const good: Result<number, string> = Result.ok(1);
    const bad: Result<number, string> = Result.err("E");
    assert.equal(good.match((n) => `ok:${n}`, (e) => `err:${e}`), "ok:1");
    assert.equal(bad.match((n) => `ok:${n}`, (e) => `err:${e}`), "err:E");
    assert.equal(bad.unwrapOrElse((e) => e.length), 1);
  });

  it("mapAsync / andThenAsync 失败短路且 await 生效", async () => {
    const good = await Result.ok(1)
      .mapAsync(async (n) => n * 2)
      .then((r) => r.andThenAsync(async (n) => Result.ok(String(n))));
    assert.equal(good.unwrapOr("x"), "2");

    const cause = new Error("async-skip");
    let called = false;
    const bad: Result<number, Error> = Result.err(cause);
    const out = await bad.mapAsync(async (n) => {
      called = true;
      return n + 1;
    });
    assert.equal(called, false, "异步失败分支同样必须短路");
    assert.ok(!out.ok);
    if (!out.ok) {
      assert.equal(out.error, cause);
    }
  });
});

describe("either 对象风格：Result.attempt* 桥接（迁移期入口）", () => {
  it("Result.attempt 捕获 throw 且保持原错误对象", () => {
    const cause = vfsNotFound("/y");
    const caught = Result.attempt((): number => {
      throw cause;
    });
    assert.ok(!caught.ok);
    if (!caught.ok) {
      assert.equal(caught.error, cause, "捕获物不得被包装");
    }
    assert.equal(Result.attempt(() => 7).unwrapOr(-1), 7);
  });

  it("Result.attemptAsync 捕获 reject", async () => {
    const cause = vfsNotFound("/z");
    const caught = await Result.attemptAsync(async (): Promise<number> => {
      throw cause;
    });
    assert.ok(!caught.ok);
    if (!caught.ok) {
      assert.equal(caught.error, cause);
    }
    const fine = await Result.attemptAsync(async () => "done");
    assert.equal(fine.unwrapOr("fallback"), "done");
  });

  it("Result.attempt：所有抛出物一律进 Err，桥接层从不重抛", () => {
    // 域错误：原对象进 Err，守卫照常可用
    const domain = vfsNotFound("/w");
    const caughtDomain = Result.attempt((): number => {
      throw domain;
    });
    assert.ok(!caughtDomain.ok);
    if (!caughtDomain.ok) {
      assert.equal(caughtDomain.error, domain);
      assert.equal(isVfsError(caughtDomain.error), true);
    }

    // 基础设施故障：同样进 Err、不重抛（「异常不外泄」的牙齿）
    const infra = new Error("SQLITE_OFFLINE");
    const caughtInfra = Result.attempt((): number => {
      throw infra;
    });
    assert.ok(!caughtInfra.ok);
    if (!caughtInfra.ok) {
      assert.equal(caughtInfra.error, infra);
      assert.equal(
        isVfsError(caughtInfra.error),
        false,
        "非域错误不由域守卫认领，但必须已被包进 Err"
      );
    }

    // 非 Error 抛出物（字符串）：照样包住，不穿成异常
    const thrownString = Result.attempt((): number => {
      throw "boom";
    });
    assert.ok(!thrownString.ok);
    if (!thrownString.ok) {
      assert.equal(thrownString.error, "boom");
    }
  });

  it("Result.attemptAsync：任何 reject 原因都进 Err，从不重抛", async () => {
    const domain = vfsNotFound("/async");
    const caughtDomain = await Result.attemptAsync(async (): Promise<number> => {
      throw domain;
    });
    assert.ok(!caughtDomain.ok);
    if (!caughtDomain.ok) {
      assert.equal(caughtDomain.error, domain);
      assert.equal(isVfsError(caughtDomain.error), true);
    }

    const infra = new Error("DISK_FULL");
    const caughtInfra = await Result.attemptAsync(async (): Promise<number> => {
      throw infra;
    });
    assert.ok(!caughtInfra.ok);
    if (!caughtInfra.ok) {
      assert.equal(caughtInfra.error, infra);
    }
  });
});

describe("either 对象风格：跨进程序列化往返", () => {
  it("toJSON 显式产出线上形态，错误判别字段完整", () => {
    const wire = Result.err(vfsNotFound("/x")).toJSON();
    assert.ok(!wire.ok);
    if (!wire.ok) {
      const error = wire.error as { name?: string; message?: string; code?: string };
      assert.equal(error.name, "VfsError");
      assert.equal(error.code, "NOT_FOUND");
      assert.match(error.message ?? "", /Path not found/);
    }
    const okWire = Result.ok(5).toJSON();
    assert.ok(okWire.ok);
    assert.equal(okWire.ok ? okWire.value : -1, 5);
  });

  it("JSON 往返：revive 后方法与结构守卫都活着（无 toJSON 必红）", () => {
    const original = vfsNotFound("/docs/a.md");
    // 边界处的一次断言：同版本内部通道，载荷形状由两侧共同代码保证。
    const transported = JSON.parse(
      JSON.stringify(Result.err(original))
    ) as ResultWire<number>;
    const revived = Result.revive<number, ReturnType<typeof vfsNotFound>>(
      transported
    );
    assert.ok(!revived.ok);
    if (!revived.ok) {
      assert.ok(revived.error instanceof Error, "错误侧必须重建为 Error 实例");
      assert.equal(
        isVfsError(revived.error),
        true,
        "revive 后 name/code 已回填，结构守卫必须照常可用"
      );
      assert.equal((revived.error as { code?: string }).code, "NOT_FOUND");
      assert.equal((revived.error as { path?: string }).path, "/docs/a.md");
    }
    assert.equal(revived.unwrapOr(-1), -1, "revive 产物必须带方法");

    const okBack = Result.revive<number, never>(
      JSON.parse(JSON.stringify(Result.ok(5)))
    );
    assert.equal(okBack?.unwrapOr(-1), 5);
    assert.equal(okBack?.map((n) => n + 1).unwrapOr(-1), 6);
  });

  it("structuredClone 形态：方法丢失、revive 复活", () => {
    const original = Result.ok(5);
    const cloned: unknown = structuredClone(original);
    assert.equal(
      (cloned as { map?: unknown }).map,
      undefined,
      "跨 structuredClone 后原型方法必丢——这正是 revive 存在的理由"
    );
    const back = Result.revive<number, never>(cloned as ResultWire<number>);
    assert.equal(back?.unwrapOr(-1), 5);
    assert.equal(back?.map((n) => n * 2).unwrapOr(-1), 10);
  });

  it("structuredClone 直传 Error 本体：revive 保持原对象", () => {
    const cause = vfsNotFound("/direct");
    const revived = Result.revive<number, ReturnType<typeof vfsNotFound>>({
      ok: false,
      error: cause,
    });
    assert.ok(!revived.ok);
    if (!revived.ok) {
      assert.equal(revived.error, cause, "Error 本体到达时必须原样保留，不得重建");
    }
  });

  it("revive 对形状违约的载荷抛错（断言不成立时快速失败，不伪造分支）", () => {
    assert.throws(
      () => Result.revive({} as ResultWire<number>),
      /非 Result 线上形态/
    );
    assert.throws(
      () => Result.revive("nope" as unknown as ResultWire<number>),
      /非 Result 线上形态/
    );
  });
});

describe("either 对象风格：Result.toError 归一", () => {
  it("Error 原样返回（保住子类与 code），字符串包成 Error 且 cause 保留原值", () => {
    const original = vfsNotFound("/keep");
    assert.equal(Result.toError(original), original, "Error 必须原对象透传");

    const wrapped = Result.toError("raw string");
    assert.ok(wrapped instanceof Error);
    assert.equal(wrapped.message, "raw string");
    assert.equal(wrapped.cause, "raw string");

    const fromObject = Result.toError({ reason: "disk" });
    assert.match(fromObject.message, /disk/);
    assert.deepEqual(fromObject.cause, { reason: "disk" });
  });
});
