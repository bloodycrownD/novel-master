/**
 * Decode unknown via Zod schema.
 *
 * @module infra/serialization/decode
 */

import type { ZodError, ZodType } from "zod";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/**
 * Parses and validates `raw` with `schema`;
 * 校验失败是用户内容错误，沿 `Result.err` 回传，不抛。
 *
 * 四期收口注：schema 的 preprocess（如 agent-definition-preprocess 的
 * removed-feature 拦截）走「直接 throw AppError」的失败协议，zod 的
 * safeParse 不接住 JS 异常——四期签名 Result 化后若放任穿透，decode 会变成
 * 「有的失败回 Err、有的失败抛」的骑墙契约。这里统一接住：AppError 原样进
 * Err（保留 code / detail），其余抛出物包成 CONFIG_DECODE_INVALID_SCHEMA。
 */
export function decode<T>(raw: unknown, schema: ZodType<T>): Result<T, AppError> {
  let parsed: { success: true; data: T } | { success: false; error: ZodError };
  try {
    parsed = schema.safeParse(raw);
  } catch (error) {
    if (error instanceof AppError) {
      return Result.err(error);
    }
    return Result.err(new AppError("CONFIG_DECODE_INVALID_SCHEMA", { detail: error instanceof Error ? error.message : String(error) }));
  }
  if (!parsed.success) {
    // schema 回调（superRefine）可把已构造的域 AppError 挂进 issue params 走
    // 数据通道携带出来（agent-definition.schema 的 prompts 布局校验，五期门⑦）：
    // 原样进 Err 保 key / detail / descriptor；其余 zod 校验失败维持旧转码。
    for (const issue of parsed.error.issues) {
      const carried = (issue as { params?: { appError?: unknown } }).params?.appError;
      if (carried instanceof AppError) {
        return Result.err(carried);
      }
    }
    return Result.err(new AppError("CONFIG_DECODE_INVALID_SCHEMA", { detail: parsed.error.message }));
  }
  return Result.ok(parsed.data);
}
