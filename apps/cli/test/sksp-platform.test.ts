/**
 * T-DS5：CLI 启动时应根据 `process.platform` 选择对应的 SKSP driver，
 * 无 driver 的平台必须明确抛错，而不是悄悄回落到 windows。
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
    assert.equal(name, "macos");
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
    assert.equal(name, "windows");
    assert.equal(resolveSkspDriver("windows").name, "windows");
  } finally {
    clearSkspDrivers();
  }
});

test("linux 应注册 linux driver", () => {
  clearSkspDrivers();
  try {
    const name = registerPlatformSkspDriver("linux");
    assert.equal(name, "linux");
    assert.equal(resolveSkspDriver("linux").name, "linux");
  } finally {
    clearSkspDrivers();
  }
});
