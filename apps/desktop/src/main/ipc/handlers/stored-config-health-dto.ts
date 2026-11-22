/**
 * core StoredConfigHealth → IPC StoredConfigHealthDto。
 *
 * namespace 注：按文件名应叫 `StoredConfigHealthDto`，但 shared 的 wire 类型
 * `StoredConfigHealthDto<T>`（本文件签名在用）与本地同名 const 不可共存
 * （TS2300/TS2395 实测），按内容主体起名 `StoredConfigHealthMapper`（§9.7 冲突逃生口）。
 */
import type { StoredConfigHealth } from "@novel-master/core/stored-config-validity";
import type { StoredConfigHealthDto } from "../../../../shared/ipc-types.js";

export const StoredConfigHealthMapper = {
    toDto<TValue extends object>(health: StoredConfigHealth<TValue>): StoredConfigHealthDto<TValue> {
        if (health.status === "valid") {
            return { status: "valid", value: health.value };
        }
        return {
            status: "invalid",
            code: health.code,
            message: health.message,
            ...(health.storedSchemaVersion != null
                ? { storedSchemaVersion: health.storedSchemaVersion }
                : {}),
        };
    },
} as const;
