/**
 * T-DS5：CLI 启动时应根据 `process.platform` 选择对应的 SKSP driver，
 * 无 driver 的平台必须返回 Result.err（错误通道迁移六期），而不是悄悄
 * 回落到 windows。
 *
 * @module sksp-platform.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSkspDrivers,
  resolveSkspDriver,
} from "@novel-master/core/sksp";
import { registerPlatformSkspDriver } from "../src/runtime.js";

test("darwin 应注册 macos driver", () => {
  clearSkspDrivers();
  try {
    const name = registerPlatformSkspDriver("darwin");
    assert.ok(name.ok, "darwin 是受支持平台，不应失败");
    assert.equal(name.value, "macos");
    // 注册后通过 resolveSkspDriver 能取到 macos driver，才算真的注册成功
    assert.equal(resolveSkspDriver("macos").name, "macos");
  } finally {
    clearSkspDrivers();
  }
});

test("win32 应注册 windows driver", () => {
  clearSkspDrivers();
  try {
    const name = registerPlatformSkspDriver("win32");
    assert.ok(name.ok, "win32 是受支持平台，不应失败");
    assert.equal(name.value, "windows");
    assert.equal(resolveSkspDriver("windows").name, "windows");
  } finally {
    clearSkspDrivers();
  }
});

test("linux 应注册 linux driver", () => {
  clearSkspDrivers();
  try {
    const name = registerPlatformSkspDriver("linux");
    assert.ok(name.ok, "linux 是受支持平台，不应失败");
    assert.equal(name.value, "linux");
    assert.equal(resolveSkspDriver("linux").name, "linux");
  } finally {
    clearSkspDrivers();
  }
});
