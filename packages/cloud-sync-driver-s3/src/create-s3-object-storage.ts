import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { readFile, writeFile } from "node:fs/promises";
import { CloudSyncError, type ObjectStorageHeadResult, type ObjectStoragePort } from "@novel-master/core";
import type { S3StorageConfig } from "./s3-config.js";

/** 测试注入用：可传入自定义 S3Client 以 mock SDK。 */
export type S3ObjectStorageDeps = {
  client?: S3Client;
  /** 读取本地文件（Mobile 可注入 react-native-blob-util 实现） */
  readFile?: (path: string) => Promise<Uint8Array>;
  /** 写入本地文件（Mobile 可注入 react-native-blob-util 实现） */
  writeFile?: (path: string, bytes: Uint8Array) => Promise<void>;
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

/** 阿里云 OSS S3 兼容 API 不支持 PutObject 条件头（If-Match / If-None-Match）。 */
export function isAliyunOssEndpoint(endpoint: string): boolean {
  const host = endpoint
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.toLowerCase();
  return host != null && host.includes("aliyuncs.com");
}

function assertConditionalPutPreconditions(
  head: ObjectStorageHeadResult,
  options?: { ifMatch?: string; ifNoneMatch?: string },
): void {
  if (options?.ifMatch != null) {
    if (!head.exists || head.etag !== options.ifMatch) {
      throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
    }
  }
  if (options?.ifNoneMatch != null) {
    if (options.ifNoneMatch === "*") {
      if (head.exists) {
        throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
      }
    } else if (head.exists && head.etag === options.ifNoneMatch) {
      throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
    }
  }
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
  const emulateConditionalPut = isAliyunOssEndpoint(config.endpoint);
  const readLocalFile = deps?.readFile ?? ((path: string) => readFile(path));
  const writeLocalFile =
    deps?.writeFile ??
    (async (path: string, bytes: Uint8Array) => {
      await writeFile(path, bytes);
    });

  const storage: ObjectStoragePort = {
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
      const hasConditionalPut =
        options?.ifMatch != null || options?.ifNoneMatch != null;
      let putOptions = options;

      if (emulateConditionalPut && hasConditionalPut) {
        const head = await this.head(key);
        assertConditionalPutPreconditions(head, options);
        putOptions = undefined;
      }

      try {
        const response = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            IfMatch: putOptions?.ifMatch,
            IfNoneMatch: putOptions?.ifNoneMatch,
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

    async putFile(key, filePath, options) {
      const raw = await readLocalFile(filePath);
      const body = new Uint8Array(raw);
      return storage.put(key, body, options);
    },

    async getToPath(key, destPath) {
      const { body, etag } = await storage.get(key);
      await writeLocalFile(destPath, body);
      return { etag };
    },
  };

  return storage;
}
