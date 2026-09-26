/**
 * desktop 实时 token 估算器绑定（stream-metrics-native ②，cr-fix-spec metrics/G-1）。
 *
 * 这份绑定此前**零断言覆盖**，而它是唯一用裸 `import { Tiktoken } from
 * "js-tiktoken/lite"` 拿 ranks 的一份（mobile 那份还多一层
 * `(mod.default ?? mod)` 兜底）——打包形态或依赖版本一变，坏的是生产
 * renderer，CI 一声不吭。
 *
 * 第 4 条（编码表单例复用）依赖 `test/js-tiktoken-hook.mjs` 那个
 * `module.register` 钩子：desktop 跑在真 ESM 下，静态具名导入在模块求值时
 * 就绑定了原导出，测试侧事后 monkey-patch 打不进去。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDesktopStreamTokenEstimator } from "@/hooks/stream-token-estimator";

/**
 * 钩子提供的计数读口。
 *
 * `__test__` 是 `test/js-tiktoken-hook.mjs` 动态挂上的导出，**不在
 * `js-tiktoken` 的类型声明里**。这处 cast 只为给这一个钩子读口补类型——
 * 不去改 `js-tiktoken` 包的类型声明，也不用 `any` 糊过去。读法是**在测试
 * 文件里直接 import 该模块**（钩子对所有 importer 生效，与被测源码拿到的是
 * 同一个模块实例），不是去 require 钩子文件本身。
 */
const { __test__: jsTiktokenTestHandle } = (await import(
  "js-tiktoken/lite"
)) as unknown as {
  readonly __test__: {readonly constructionCount: number};
};

describe("desktop 实时 token 估算器绑定（metrics/G-1）", () => {
  it("模块级编码单例复用：连续两次建估算器只触发一次编码表构造", () => {
    // 本条**必须是文件里的第一条用例**：编码表是模块级单例，前面任何一条用例
    // 调过 `createDesktopStreamTokenEstimator()` 都会把它建好、让这里的
    // 「首次调用 +1」退化成「+0」。node:test 按声明顺序执行子测试，位置即是
    // 断言的一部分。
    //
    // 不做「第二次构造耗时 < 5ms」这类计时断言：CI 抖动会误红，且它区分不了
    // 「命中模块级缓存」与「没命中但这次恰好很快」——正是本条要防的退化。只读
    // 钩子记的构造计数。
    const before = jsTiktokenTestHandle.constructionCount;
    assert.equal(before, 0, "本条之前不应有任何编码表构造");

    const first = createDesktopStreamTokenEstimator();
    assert.notEqual(first, null);
    const afterFirst = jsTiktokenTestHandle.constructionCount;
    assert.equal(afterFirst, before + 1, "首次调用应构造一次编码表");

    createDesktopStreamTokenEstimator();
    assert.equal(
      jsTiktokenTestHandle.constructionCount,
      afterFirst,
      "第二次调用应命中模块级缓存、不再构造编码表",
    );
  });

  it("建得出来：push('hello world') 后 tokens === 2", () => {
    const counter = createDesktopStreamTokenEstimator();
    assert.notEqual(counter, null);
    counter!.push("hello world");
    assert.equal(counter!.tokens, 2);
  });

  it("两次调用返回独立实例：a.push 不影响 b", () => {
    const a = createDesktopStreamTokenEstimator();
    const b = createDesktopStreamTokenEstimator();
    assert.notEqual(a, null);
    assert.notEqual(b, null);
    assert.notEqual(a, b);
    a!.push("hello world");
    assert.equal(a!.tokens, 2);
    assert.equal(b!.tokens, 0);
  });

  it("reset() 后归零", () => {
    const counter = createDesktopStreamTokenEstimator();
    assert.notEqual(counter, null);
    counter!.push("hello world");
    assert.equal(counter!.tokens, 2);
    counter!.reset();
    assert.equal(counter!.tokens, 0);
  });
});
