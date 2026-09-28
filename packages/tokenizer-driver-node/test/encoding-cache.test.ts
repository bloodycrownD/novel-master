/**
 * T-FA7（main 侧）：`model:` 键废除后的编码表构造计数语义。
 *
 * desktop main 的计数路径用 WASM `tiktoken` 包建表，**不在**
 * `js-tiktoken-hook`（只拦 js-tiktoken/lite，覆盖 renderer 进程）的计数
 * 范围内，所以 main 侧改用 `__setNodeEncodingFactoryForTests` 注入**计数
 * 构造器**来数——断言的不是 WASM 构造本身，而是「谁向 registry 要了几次表」。
 *
 * 要钉住的语义：registry 只认 `enc:<encodingName>` 单键空间（历史上的
 * `model:` 命名空间已废除）。因此按模型名取（精确档，内部把模型名解析成
 * 编码名）与按编码名取（cl100k 预热 / 兜底档）落到同一把键上——同一张表
 * 只构造一次；分键的维度是**编码名**而非模型名。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Tiktoken } from "tiktoken";

import {
  __setNodeEncodingFactoryForTests,
  getDefaultNodeEncoding,
  getNodeEncodingByName,
  getNodeEncodingForModel,
} from "../src/impl/encoding-cache.js";

/** 计数版假表：encode 返回带 length 的序列即满足 `EncodingHandle` 契约。 */
function fakeEncoding(): Tiktoken {
  return {
    encode: (text: string) => new Array<number>(text.length).fill(0),
  } as unknown as Tiktoken;
}

describe("encoding-cache 构造计数（T-FA7 main 侧）", () => {
  it("model: 键废除后精确档与 cl100k 预热共享同键：gpt-4 与默认表只构造一次", () => {
    let constructions = 0;
    __setNodeEncodingFactoryForTests(() => {
      constructions += 1;
      return fakeEncoding();
    });
    try {
      // 精确档：按模型名取——内部走 tiktoken 官方映射把 gpt-4 解析成
      // cl100k_base，再进 registry 的 `enc:cl100k_base` 单键空间。
      const precise = getNodeEncodingForModel("gpt-4");
      assert.notEqual(precise, null);
      assert.equal(constructions, 1, "精确档首次取表应构造一次");

      // cl100k 预热 / 兜底档：按编码名取同一张表。`model:` 与 `enc:` 双命名
      // 空间互不命中的时代已结束——两路同键命中，不再有第二次建表。
      const warmup = getDefaultNodeEncoding();
      assert.notEqual(warmup, null);
      assert.equal(constructions, 1, "预热与精确档共享同键，不应再构造");
      assert.equal(warmup, precise, "预热拿到的应是同一个共享句柄");

      // 按编码名显式取也命中同一张表。
      assert.equal(getNodeEncodingByName("cl100k_base"), precise);
      assert.equal(constructions, 1, "显式按编码名取也不应再构造");
    } finally {
      // 还原真实构造器（会顺带作废缓存），别把假表留给后续用例。
      __setNodeEncodingFactoryForTests(null);
    }
  });

  it("分键维度是编码名而非模型名：gpt-4o（o200k）与 gpt-4（cl100k）各建各的", () => {
    let constructions = 0;
    __setNodeEncodingFactoryForTests(() => {
      constructions += 1;
      return fakeEncoding();
    });
    try {
      const o200k = getNodeEncodingForModel("gpt-4o");
      const cl100k = getNodeEncodingForModel("gpt-4");
      assert.notEqual(o200k, null);
      assert.notEqual(cl100k, null);
      assert.notEqual(o200k, cl100k, "不同编码名应是两张不同的表");
      assert.equal(constructions, 2, "两个编码名各构造一次");

      // 同一编码名的另一个模型名（gpt-3.5-turbo 同属 cl100k_base）复用已有表。
      const gpt35 = getNodeEncodingForModel("gpt-3.5-turbo");
      assert.equal(gpt35, cl100k, "同编码名的不同模型应复用同一张表");
      assert.equal(constructions, 2);
    } finally {
      __setNodeEncodingFactoryForTests(null);
    }
  });
});
