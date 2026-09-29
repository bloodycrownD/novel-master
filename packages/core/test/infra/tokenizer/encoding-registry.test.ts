/**
 * T-FA1（fallback-caliber-align Step 1）：编码表注册中心的生命周期语义。
 *
 * 守三条不变量：
 * 1. 同键同构造器只构造一次（单例语义，构造计数钉死）；
 * 2. 失败缓存 `null` 后 TTL 内不重试、假时钟推进超 TTL 后重试成功
 *    （重试再失败则从重试时刻重起新窗口）；
 * 3. 测试钩子「清缓存 / 换构造器」各管一件事、互不干扰。
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  ENCODING_RETRY_TTL_MS,
  getEncoding,
  clearForTests,
  setFactoryForTests,
  setClockForTests,
  type EncodingHandle,
} from "../../../src/infra/tokenizer/encoding-registry.js";

/** 最小可用的假句柄：encode 出 { length }。 */
function makeHandle(tag: string): EncodingHandle {
  return {
    encode: (text: string) => ({ length: text.length + tag.length }),
  };
}

/** 可控假时钟：手动推进 now。 */
let fakeNow = 1_000;
const fakeClock = (): number => fakeNow;

describe("encoding-registry T-FA1", () => {
  after(() => {
    // 还原全局状态，别把假时钟 / 故障构造器留给同进程的其它测试文件。
    setClockForTests(null);
    setFactoryForTests(null);
    clearForTests();
  });

  describe("单例语义", () => {
    it("同键同构造器只构造一次，两次取用返回同一句柄", () => {
      clearForTests();
      let builds = 0;
      const handle = makeHandle("only");
      const build = (): EncodingHandle => {
        builds += 1;
        return handle;
      };

      const first = getEncoding("cl100k_base", build);
      const second = getEncoding("cl100k_base", build);

      assert.equal(first, handle);
      assert.equal(second, handle);
      assert.equal(builds, 1);
    });

    it("不同编码名各自构造（enc: 单命名空间下不同键互不串）", () => {
      clearForTests();
      const built: string[] = [];
      const buildFor = (tag: string) => (): EncodingHandle => {
        built.push(tag);
        return makeHandle(tag);
      };

      const cl = getEncoding("cl100k_base", buildFor("cl100k_base"));
      const o2 = getEncoding("o200k_base", buildFor("o200k_base"));

      assert.notEqual(cl, o2);
      assert.deepEqual(built, ["cl100k_base", "o200k_base"]);
    });
  });

  describe("失败缓存与 TTL 重试", () => {
    it("失败缓存 null 后 TTL 内不重试（构造器调用数不增）", () => {
      clearForTests();
      setClockForTests(fakeClock);
      fakeNow = 1_000;
      let attempts = 0;
      const fail = (): EncodingHandle => {
        attempts += 1;
        throw new Error("boom: ranks unavailable");
      };

      assert.equal(getEncoding("cl100k_base", fail), null);
      assert.equal(attempts, 1);

      // TTL 内推进（含 0 与边界差 1ms）：一律命中失败缓存，不重试。
      fakeNow = 1_000;
      assert.equal(getEncoding("cl100k_base", fail), null);
      fakeNow = 1_000 + ENCODING_RETRY_TTL_MS - 1;
      assert.equal(getEncoding("cl100k_base", fail), null);
      assert.equal(attempts, 1);
    });

    it("假时钟推进超过 TTL 后重试成功", () => {
      clearForTests();
      setClockForTests(fakeClock);
      fakeNow = 2_000;
      let attempts = 0;
      // 第一次抛错、之后成功的构造器：验证「失败 → TTL 过 → 重试成功」全链路。
      const flaky = (): EncodingHandle => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient failure");
        }
        return makeHandle("recovered");
      };

      assert.equal(getEncoding("o200k_base", flaky), null);
      fakeNow = 2_000 + ENCODING_RETRY_TTL_MS;
      const recovered = getEncoding("o200k_base", flaky);

      assert.notEqual(recovered, null);
      assert.equal(attempts, 2);
      // 成功后失败记录清除：再次取用直接命中成功缓存。
      const again = getEncoding("o200k_base", flaky);
      assert.equal(again, recovered);
      assert.equal(attempts, 2);
    });

    it("重试再失败则从重试时刻重起新 TTL 窗口", () => {
      clearForTests();
      setClockForTests(fakeClock);
      fakeNow = 10_000;
      let attempts = 0;
      const alwaysFail = (): EncodingHandle => {
        attempts += 1;
        throw new Error("still broken");
      };

      assert.equal(getEncoding("cl100k_base", alwaysFail), null);
      fakeNow = 10_000 + ENCODING_RETRY_TTL_MS;
      assert.equal(getEncoding("cl100k_base", alwaysFail), null); // 重试再失败
      assert.equal(attempts, 2);

      // 从重试时刻（而非首次失败时刻）重新计窗：差 1ms 仍不重试。
      fakeNow = 10_000 + ENCODING_RETRY_TTL_MS + ENCODING_RETRY_TTL_MS - 1;
      assert.equal(getEncoding("cl100k_base", alwaysFail), null);
      assert.equal(attempts, 2);

      // 过了第二个窗口才再次重试。
      fakeNow = 10_000 + 2 * ENCODING_RETRY_TTL_MS;
      assert.equal(getEncoding("cl100k_base", alwaysFail), null);
      assert.equal(attempts, 3);
    });
  });

  describe("测试钩子互不干扰", () => {
    it("clearForTests 只清缓存，不还原构造器", () => {
      clearForTests();
      let factoryBuilds = 0;
      const factory = (): EncodingHandle => {
        factoryBuilds += 1;
        return makeHandle("factory");
      };
      setFactoryForTests(factory);
      // 最自然的测试写法：清缓存后取用，应仍走注入的构造器。
      clearForTests();

      const a = getEncoding("cl100k_base", () => makeHandle("ignored"));
      assert.notEqual(a, null);
      assert.equal(factoryBuilds, 1);
    });

    it("clearForTests 清缓存后 getEncoding 会重新执行 build", () => {
      clearForTests();
      setFactoryForTests(null);
      let builds = 0;
      const build = (): EncodingHandle => {
        builds += 1;
        return makeHandle("rebuild");
      };

      const first = getEncoding("cl100k_base", build);
      clearForTests();
      const second = getEncoding("cl100k_base", build);

      assert.notEqual(second, null);
      assert.notEqual(second, first); // 引用已丢弃重建（不 free，见模块头）
      assert.equal(builds, 2);
    });

    it("setFactoryForTests 换构造器时顺带作废既有缓存", () => {
      clearForTests();
      setFactoryForTests(null);
      const original = makeHandle("original");
      const first = getEncoding("cl100k_base", () => original);
      assert.equal(first, original);

      const factoryHandle = makeHandle("factory");
      setFactoryForTests(() => factoryHandle);

      const second = getEncoding("cl100k_base", () => original);
      assert.equal(second, factoryHandle); // 不吃旧缓存，改走新构造器
    });

    it("setFactoryForTests(null) 还原为调用方注入的 build", () => {
      clearForTests();
      const factoryHandle = makeHandle("temp");
      setFactoryForTests(() => factoryHandle);
      assert.equal(getEncoding("cl100k_base", () => makeHandle("real")), factoryHandle);

      setFactoryForTests(null);
      const real = makeHandle("real");
      assert.equal(getEncoding("cl100k_base", () => real), real);
    });
  });
});
