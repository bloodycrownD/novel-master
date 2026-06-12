/**
 * 对象存储端口（与 @novel-master/core ObjectStoragePort 对齐）。
 *
 * @remarks core Phase 1 合并后改为从 core 导入并删除本文件。
 */
export type ObjectStorageHeadResult = {
  exists: boolean;
  etag?: string;
  bytes?: number;
};

export interface ObjectStoragePort {
  head(key: string): Promise<ObjectStorageHeadResult>;
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  put(
    key: string,
    body: Uint8Array,
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<{ etag: string }>;
}
