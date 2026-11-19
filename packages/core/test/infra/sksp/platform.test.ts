import {  describe, it  } from "node:test";
import assert from "node:assert/strict";
import {  SkspPlatform  } from "../../../src/infra/sksp/logic/platform.js";

describe("SKSP platform 解析（A-20）", () => {
  it("darwin → macos", () => {
    const resolved = SkspPlatform.resolveName("darwin");
    assert.ok(resolved.ok);
    assert.equal(resolved.value, "macos");
  });

  it("win32 → windows", () => {
    const resolved = SkspPlatform.resolveName("win32");
    assert.ok(resolved.ok);
    assert.equal(resolved.value, "windows");
  });

  it("linux → linux", () => {
    const resolved = SkspPlatform.resolveName("linux");
    assert.ok(resolved.ok);
    assert.equal(resolved.value, "linux");
  });

  it("未知 platform 字符串走 Err 通道", () => {
    const resolved = SkspPlatform.resolveName("freebsd");
    assert.ok(!resolved.ok, "未知 platform 应走 Err 通道");
    if (!resolved.ok) {
      assert.match(resolved.error.message, /Unsupported SKSP platform: freebsd/);
    }
  });

  it("空串走 Err 通道（防 RN 下 process.platform 为 undefined 时静默落到默认）", () => {
    const resolved = SkspPlatform.resolveName("");
    assert.ok(!resolved.ok, "空串应走 Err 通道");
    if (!resolved.ok) {
      assert.match(resolved.error.message, /Unsupported SKSP platform/);
    }
  });
});
