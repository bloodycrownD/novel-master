/**
 * String encoding for boolean values stored in KKV.
 *
 * @module infra/kkv-value-codec
 */

import {Result} from "@/errors/either.js";

// nm-style: keep-local — KKV 布尔线格式的编解码对（与 formatBoolean 对称）：`"true"`/`"false"` 解析失败必须给出可诊断 Err，内联进 preferences 会把 wire 格式散进 service 并孤立 codec 单测。
/** Parses KKV-stored `"true"` / `"false"`; 非布尔串返回 Err。 */
export function parseBoolean(value: string): Result<boolean, Error> {
  if (value === "true") {
    return Result.ok(true);
  }
  if (value === "false") {
    return Result.ok(false);
  }
  return Result.err(new Error(`Expected boolean string, got: ${value}`));
}

/** Formats a boolean for KKV storage (`nm-preferences` module). */
export function formatBoolean(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}
