import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { CloudSyncError, type ObjectStoragePort } from "@novel-master/core";
import type { S3StorageConfig } from "./s3-config.js";

/** 测试注入用：可传入自定义 S3Client 以 mock SDK。 */
export type S3ObjectStorageDeps = {
  client?: S3Client;
};

/** 去掉 S3 返回 ETag 两侧引号，供 status.json 条件 PUT 使用。 */
export function normalizeEtag(etag: string | undefined): string | undefined {
  if (etag == null || etag === "") {
    return undefined;
  }
  return etag.replace(/^"|"$/g, "");
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof NotFound) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NotFound" || error.name === "NoSuchKey")
  ) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  ) {
    return true;
  }
  return false;
}

function isPreconditionFailedError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "PreconditionFailed"
  ) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 412
  ) {
    return true;
  }
  return false;
}

function buildS3Client(config: S3StorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region || "us-east-1",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
  };
  return new S3Client(clientConfig);
}

/**
 * 基于 S3 兼容 API 创建 {@link ObjectStoragePort} 实现。
 */
export function createS3ObjectStorage(
  config: S3StorageConfig,
  deps?: S3ObjectStorageDeps,
): ObjectStoragePort {
  const client = deps?.client ?? buildS3Client(config);
  const bucket = config.bucket;

  return {
    async head(key) {
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return {
          exists: true,
          etag: normalizeEtag(response.ETag),
          bytes: response.ContentLength,
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return { exists: false };
        }
        throw error;
      }
    },

    async get(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const etag = normalizeEtag(response.ETag);
      if (etag == null) {
        throw new Error(`S3 GetObject 未返回 ETag: ${key}`);
      }
      const body = await response.Body?.transformToByteArray();
      if (body == null) {
        throw new Error(`S3 GetObject 未返回 Body: ${key}`);
      }
      return { body, etag };
    },

    async put(key, body, options) {
      try {
        const response = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            IfMatch: options?.ifMatch,
            IfNoneMatch: options?.ifNoneMatch,
          }),
        );
        const etag = normalizeEtag(response.ETag);
        if (etag == null) {
          throw new Error(`S3 PutObject 未返回 ETag: ${key}`);
        }
        return { etag };
      } catch (error) {
        if (isPreconditionFailedError(error)) {
          throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试", {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
