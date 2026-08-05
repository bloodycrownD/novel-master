import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSkspNameFromPlatform,
} from "../../../src/infra/sksp/logic/platform.js";

describe("SKSP platform 解析（A-20）", () => {
  it("darwin → macos", () => {
    assert.equal(resolveSkspNameFromPlatform("darwin"), "macos");
  });

  it("win32 → windows", () => {
    assert.equal(resolveSkspNameFromPlatform("win32"), "windows");
  });

  it("linux（暂无 driver）抛错", () => {
    assert.throws(
      () => resolveSkspNameFromPlatform("linux"),
      /Unsupported SKSP platform: linux/,
    );
  });

  it("未知 platform 字符串抛错", () => {
    assert.throws(
      () => resolveSkspNameFromPlatform("freebsd"),
      /Unsupported SKSP platform: freebsd/,
    );
  });

  it("空串抛错（防 RN 下 process.platform 为 undefined 时静默落到默认）", () => {
    assert.throws(
      () => resolveSkspNameFromPlatform(""),
      /Unsupported SKSP platform/,
    );
  });
});
