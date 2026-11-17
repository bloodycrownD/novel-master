import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Number as Num } from "../../src/common/number.js";

describe("common/number · Number.pad2", () => {
  it("补零到两位；超过两位原样返回不截断", () => {
    assert.equal(Num.pad2(0), "00");
    assert.equal(Num.pad2(7), "07");
    assert.equal(Num.pad2(10), "10");
    assert.equal(Num.pad2(123), "123");
    assert.equal(Num.pad2(-1), "-1");
  });
});

describe("common/number · Number.trimFraction", () => {
  it("保留一位小数并裁掉尾部的 .0", () => {
    assert.equal(Num.trimFraction(0), "0");
    assert.equal(Num.trimFraction(2), "2");
    assert.equal(Num.trimFraction(2.04), "2");
    assert.equal(Num.trimFraction(1.25), "1.3");
    assert.equal(Num.trimFraction(1.24), "1.2");
    assert.equal(Num.trimFraction(-1.04), "-1");
  });

  it("NaN / Infinity / 极大值按 toFixed 口径字符串化", () => {
    assert.equal(Num.trimFraction(globalThis.Number.NaN), "NaN");
    assert.equal(Num.trimFraction(globalThis.Number.POSITIVE_INFINITY), "Infinity");
    assert.equal(Num.trimFraction(1e21), "1e+21");
  });
});

describe("common/number · Number.formatBytes", () => {
  it("1024 进位，整数位不带 .0", () => {
    assert.equal(Num.formatBytes(0), "0B");
    assert.equal(Num.formatBytes(512), "512B");
    assert.equal(Num.formatBytes(1023), "1023B");
    assert.equal(Num.formatBytes(1024), "1KB");
    assert.equal(Num.formatBytes(1536), "1.5KB");
    assert.equal(Num.formatBytes(1024 * 1024), "1MB");
    assert.equal(Num.formatBytes(1024 * 1024 * 1.5), "1.5MB");
    assert.equal(Num.formatBytes(1024 * 1024 * 1024), "1024MB");
  });

  it("负数按字节带符号输出；非有限值原样字符串化", () => {
    assert.equal(Num.formatBytes(-5), "-5B");
    assert.equal(Num.formatBytes(-2048), "-2048B");
    assert.equal(Num.formatBytes(globalThis.Number.NaN), "NaN");
    assert.equal(Num.formatBytes(globalThis.Number.POSITIVE_INFINITY), "Infinity");
  });

  it("极大值继续以 MB 表达", () => {
    assert.equal(Num.formatBytes(globalThis.Number.MAX_SAFE_INTEGER), "8589934592MB");
  });
});
