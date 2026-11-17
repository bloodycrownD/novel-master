/**
 * KKV 结果适配：把「键缺失」从已知失败归一成 Optional 语义。
 *
 * `KkvService.get` / `delete` 把缺失键表达为 `KKV_NOT_FOUND`；当调用方把缺失
 * 当正常分支（未配置 / 幂等清除）时走本命名空间，避免每端各写一份
 * `isAppError(raw.error, "KKV_NOT_FOUND")` 分支。
 *
 * @module common/kkv
 */

import {isAppError, type AppError} from "../errors/app-error.js";
import {Result} from "../errors/either.js";
import type {KkvService} from "../service/kkv/kkv.port.js";

export const Kkv = {
    /** 读值：`KKV_NOT_FOUND` 归一为 `undefined`（Ok），其余失败沿 `Result.err` 原样接力。 */
    getOptional: async (kkv: KkvService, module: string, key: string): Promise<Result<string | undefined, AppError>> => {
        const raw = await kkv.get(module, key);
        if (raw.ok) return raw;
        return isAppError(raw.error, "KKV_NOT_FOUND") ? Result.ok(undefined) : raw;
    },

    /** 删除：`KKV_NOT_FOUND` 归一为成功（幂等清除），其余失败沿 `Result.err` 原样接力。 */
    deleteIfPresent: async (kkv: KkvService, module: string, key: string): Promise<Result<void, AppError>> => {
        const deleted = await kkv.delete(module, key);
        return deleted.ok || isAppError(deleted.error, "KKV_NOT_FOUND") ? Result.ok(undefined) : deleted;
    },

    /** 解析 KKV 布尔线格式 `"true"` / `"false"`；其余 → `null`（调用方自带错误码与文案）。 */
    parseBoolean: (value: string): boolean | null => {
        if (value === "true") return true;
        if (value === "false") return false;
        return null;
    },

    /** 布尔 → KKV 线格式（对称于 {@link parseBoolean}）。 */
    formatBoolean: (value: boolean): "true" | "false" => (value ? "true" : "false"),
} as const;
