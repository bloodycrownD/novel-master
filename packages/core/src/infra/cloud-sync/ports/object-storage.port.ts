/**
 * 对象存储端口：云同步远端 status.json 与快照的读写。
 *
 * @module infra/cloud-sync/ports/object-storage.port
 */

/** Head 对象结果 */
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
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<{ etag: string }>;
  /** 从本地文件上传对象（可选；协调器在 Push 时优先于 bytes 路径） */
  putFile?(
    key: string,
    filePath: string,
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<{ etag: string }>;
  /** 下载对象到本地文件（可选；协调器在 Pull 时优先于内存路径） */
  getToPath?(key: string, destPath: string): Promise<{ etag: string }>;
}
