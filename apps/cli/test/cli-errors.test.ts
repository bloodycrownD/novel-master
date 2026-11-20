/**
 * CLI 错误输出基线：`formatCliError` / `exitCodeForError` 对 8 类输入的真实输出
 * （T-A7 基线锁——给现状加锁，不是改现状；断言逐字取自实现实际输出）。
 *
 * 背景见 `main.ts` 的 `failExit`：cancelled 专用码（130）在管线层只打
 * `CANCELLED_MESSAGE` 一行，所以 TOOL_CANCELLED / Outcome.cancelled /
 * Outcome.replaced 喂给 `formatCliError` 的原始文案（码表中文 / `[object Object]`）
 * 并不会到达用户，只活在这份基线里。
 *
 * @module cli-errors.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "@novel-master/core/errors";
import type { Outcome } from "@novel-master/core/workplace";
import { CANCELLED_MESSAGE, exitCodeForError, formatCliError } from "../src/cli-errors.js";

describe("formatCliError", () => {
  it("AppError 带 messageKey：走码表翻译出中文文案", () => {
    assert.equal(formatCliError(new AppError("AGENT_NOT_FOUND", { agentId: "a1" })), "Agent 不存在：a1");
  });

  it("AppError 无 messageKey：回退英文 desc", () => {
    assert.equal(formatCliError(new AppError("VFS_DIRECTORY_NOT_EMPTY", { path: "a/b" })), "directory not empty");
  });

  it("普通 Error：直出 message", () => {
    assert.equal(formatCliError(new Error("boom")), "boom");
  });

  it("非 Error（字符串）：String 转换", () => {
    assert.equal(formatCliError("boom-raw"), "boom-raw");
  });

  it("TOOL_CANCELLED：走码表翻译出中文文案（管线层只打「已取消」，见 failExit）", () => {
    assert.equal(formatCliError(new AppError("TOOL_CANCELLED", { toolName: "read" })), "工具执行已取消：read");
  });

  it("Outcome.cancelled：非 Error 原样 String 成 [object Object]（管线层在调用点转「已取消」）", () => {
    const outcome: Outcome<void> = { kind: "cancelled", reason: "user-stop" };
    assert.equal(formatCliError(outcome), "[object Object]");
  });

  it("Outcome.replaced：同样 [object Object]", () => {
    const outcome: Outcome<void> = { kind: "replaced" };
    assert.equal(formatCliError(outcome), "[object Object]");
  });

  it("未知输入（undefined）：String 转换成 undefined", () => {
    assert.equal(formatCliError(undefined), "undefined");
  });
});

describe("exitCodeForError", () => {
  it("TOOL_CANCELLED 走取消专用码 130", () => {
    assert.equal(exitCodeForError(new AppError("TOOL_CANCELLED", { toolName: "read" })), 130);
  });

  it("AppError 带 messageKey 走运行时码 2", () => {
    assert.equal(exitCodeForError(new AppError("AGENT_NOT_FOUND", { agentId: "a1" })), 2);
  });

  it("AppError 无 messageKey 走运行时码 2", () => {
    assert.equal(exitCodeForError(new AppError("VFS_DIRECTORY_NOT_EMPTY", { path: "a/b" })), 2);
  });

  it("普通 Error 走运行时码 2", () => {
    assert.equal(exitCodeForError(new Error("boom")), 2);
  });

  it("非 Error（字符串）走运行时码 2", () => {
    assert.equal(exitCodeForError("boom-raw"), 2);
  });

  it("Outcome.cancelled 走运行时码 2（转 130 发生在管线层，不在本函数）", () => {
    const outcome: Outcome<void> = { kind: "cancelled", reason: "user-stop" };
    assert.equal(exitCodeForError(outcome), 2);
  });

  it("Outcome.replaced 走运行时码 2", () => {
    const outcome: Outcome<void> = { kind: "replaced" };
    assert.equal(exitCodeForError(outcome), 2);
  });

  it("未知输入（undefined）走运行时码 2", () => {
    assert.equal(exitCodeForError(undefined), 2);
  });

  it("cancelled 管线统一文案常量（failExit 打印的那一行）", () => {
    assert.equal(CANCELLED_MESSAGE, "已取消");
  });
});
