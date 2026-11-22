/**
 * 对象存储端口：云同步远端 status.json 与快照的读写。
 *
 * @module infra/cloud-sync/ports/object-storage.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/** Head 对象结果 */
// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
export type ObjectStorageHeadResult = {
    exists: boolean;
    etag?: string;
    bytes?: number;
};

/**
 * S3 兼容对象存储抽象；条件 PUT 由驱动映射 If-Match / IfNoneMatch。
 */
export interface ObjectStoragePort {
    head(key: string): Promise<ObjectStorageHeadResult>;
    get(key: string): Promise<{ body: Uint8Array; etag: string }>;
    put(
        key: string,
        body: Uint8Array,
        options?: { ifMatch?: string; ifNoneMatch?: string }
    ): Promise<Result<{ etag: string }, AppError>>;
    /** 从本地文件上传对象（可选；协调器在 Push 时优先于 bytes 路径） */
    putFile?(
        key: string,
        filePath: string,
        options?: { ifMatch?: string; ifNoneMatch?: string }
    ): Promise<Result<{ etag: string }, AppError>>;
    /** 下载对象到本地文件（可选；协调器在 Pull 时优先于内存路径） */
    getToPath?(key: string, destPath: string): Promise<Result<{ etag: string }, AppError>>;
}
