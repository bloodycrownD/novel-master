/**
 * Encode domain values to wire objects for persistence.
 *
 * @module common/serialization/encode
 */

import type { ZodType } from "zod";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** Schema with optional wire encoder for {@link SerializationEncode.encode}. */
// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
export type EncodableSchema<T> = ZodType<T> & {
    /** Wire encoder; not named `encode` to avoid clashing with Zod v4 `.encode()`. */
    readonly toWire?: (value: T) => Result<unknown, AppError>;
};

/**
 * 领域值 → wire 对象编码。
 */
export const SerializationEncode = {
    /**
   * Converts a domain value to a JSON-serializable wire object; 已知失败
   * （如 agent 定义的块名唯一性门禁）沿 `Result.err` 回传，不抛。
   */
    encode<T>(value: T, schema: EncodableSchema<T>): Result<unknown, AppError> {
        const encoder = schema.toWire;
        if (encoder == null) {
            return Result.err(new AppError("CONFIG_DECODE_ENCODE_NOT_SUPPORTED", { detail: "schema does not define toWire" }));
        }
        return encoder(value);
    },
} as const;
