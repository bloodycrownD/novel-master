import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import type { ObjectStoragePort } from "@novel-master/core";
import type { S3StorageConfig } from "./s3-config.js";
import type { FileSystemPort } from "./ports/file-system.port.js";

/** 测试注入用：可传入自定义 S3Client 以 mock SDK。 */
export type S3ObjectStorageDeps = {
  client?: S3Client;
  /**
   * 本地文件系统访问：putFile / getToPath 会用到。
   *
   * driver 自身不再静态依赖 `node:fs/promises`，由调用方注入 Node 或 RN 的实现
   * （对应 A-26）。不注入时，putFile / getToPath 调用会抛错。
   */
  fileSystem?: FileSystemPort;
};

/** 去掉 S3 返回 ETag 两侧引号，供 status.json 条件 PUT 使用。 */
export function normalizeEtag(etag: string | undefined): string | undefined {
  if (etag == null || etag === "") {
    return undefined;
  }
  return etag.replace(/^"|"$/g, "");
}

/** 阿里云 OSS S3 兼容 API 不支持 PutObject 条件头（If-Match / If-None-Match）。 */
export function isAliyunOssEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim().replace(/^https?:\/\//, "");
  const host = trimmed.split("/")[0]?.toLowerCase();
  return host != null && host.includes("aliyuncs.com");
}

/**
 * 基于 S3 兼容 API 创建 {@link ObjectStoragePort} 实现。
 */
export function createS3ObjectStorage(config: S3StorageConfig, deps?: S3ObjectStorageDeps): ObjectStoragePort {
  const clientConfig: S3ClientConfig = {
    region: config.region || "us-east-1",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
  };
  const client = deps?.client ?? new S3Client(clientConfig);
  const bucket = config.bucket;
  const emulateConditionalPut = isAliyunOssEndpoint(config.endpoint);
  const fileSystem = deps?.fileSystem;

  const storage: ObjectStoragePort = {
    async head(key) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          exists: true,
          etag: normalizeEtag(response.ETag),
          bytes: response.ContentLength,
        };
      } catch (error) {
        if (
          error instanceof NotFound ||
          (typeof error === "object" && error !== null && "name" in error && (error.name === "NotFound" || error.name === "NoSuchKey")) ||
          (typeof error === "object" &&
            error !== null &&
            "$metadata" in error &&
            typeof error.$metadata === "object" &&
            error.$metadata !== null &&
            "httpStatusCode" in error.$metadata &&
            error.$metadata.httpStatusCode === 404)
        ) {
          return { exists: false };
        }
        throw error;
      }
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const etag = normalizeEtag(response.ETag);
      if (etag == null) {
        // nm-throw: keep — S3 第三方 SDK 边界：GetObject 响应缺 ETag 属服务端异常，由上层基础设施错误收口。
        throw new Error(`S3 GetObject 未返回 ETag: ${key}`);
      }
      const body = await response.Body?.transformToByteArray();
      if (body == null) {
        // nm-throw: keep — S3 第三方 SDK 边界：GetObject 响应缺 Body 属服务端异常，由上层基础设施错误收口。
        throw new Error(`S3 GetObject 未返回 Body: ${key}`);
      }
      return { body, etag };
    },

    async put(key, body, options) {
      const hasConditionalPut = options?.ifMatch != null || options?.ifNoneMatch != null;
      let putOptions = options;

      if (emulateConditionalPut && hasConditionalPut) {
        // 阿里云 OSS 无条件头：head 后按 If-Match / If-None-Match 语义判冲突（Result.err 上行）。
        const head = await this.head(key);
        if (options?.ifMatch != null) {
          if (!head.exists || head.etag !== options.ifMatch) {
            return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION", { detail: "同步冲突，请重试" }));
          }
        }
        if (options?.ifNoneMatch != null) {
          if (options.ifNoneMatch === "*") {
            if (head.exists) {
              return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION", { detail: "同步冲突，请重试" }));
            }
          } else if (head.exists && head.etag === options.ifNoneMatch) {
            return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION", { detail: "同步冲突，请重试" }));
          }
        }
        putOptions = undefined;
      }

      try {
        const response = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, IfMatch: putOptions?.ifMatch, IfNoneMatch: putOptions?.ifNoneMatch }));
        const etag = normalizeEtag(response.ETag);
        if (etag == null) {
          // nm-throw: keep — S3 第三方 SDK 边界：PutObject 响应缺 ETag 属服务端异常，由上层基础设施错误收口。
          throw new Error(`S3 PutObject 未返回 ETag: ${key}`);
        }
        return Result.ok({ etag });
      } catch (error) {
        if (
          (typeof error === "object" && error !== null && "name" in error && error.name === "PreconditionFailed") ||
          (typeof error === "object" &&
            error !== null &&
            "$metadata" in error &&
            typeof error.$metadata === "object" &&
            error.$metadata !== null &&
            "httpStatusCode" in error.$metadata &&
            error.$metadata.httpStatusCode === 412)
        ) {
          return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION", { detail: "同步冲突，请重试" }, { cause: error }));
        }
        throw error;
      }
    },

    async putFile(key, filePath, options) {
      if (fileSystem == null) {
        return Result.err(new AppError("CLOUD_SYNC_NOT_CONFIGURED", { detail: "未注入 FileSystemPort，无法读取本地文件（A-26）" }));
      }
      const raw = await fileSystem.readFile(filePath);
      // `readFile` 的返回类型本身就是 Uint8Array，`new Uint8Array(raw)` 是
      // 逐元素复制（不是视图化、不是零拷贝）⇒ 对已经是 Uint8Array 的输入
      // 白拷一份，峰值 = 1 份 + 1 份（mobile 侧还要再加 base64 的放大）。
      // 保留 instanceof 兜底是为了容忍注入了返回 ArrayBuffer / 非 TypedArray
      // 的 FileSystemPort 这类越界实现（类型上多余，但零成本、不改对外行为）。
      //
      // 刻意**不**改成 `new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)`：
      // 那会把 Buffer 的底层 ArrayBuffer 交给 SDK，若 SDK 任何一处再做一次
      // 拷贝就白忙，且共享底层意味着「谁改谁遭殃」。直接透传引用最省。
      const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      return storage.put(key, body, options);
    },

    async getToPath(key, destPath) {
      const { body, etag } = await storage.get(key);
      if (fileSystem == null) {
        return Result.err(new AppError("CLOUD_SYNC_NOT_CONFIGURED", { detail: "未注入 FileSystemPort，无法写入本地文件（A-26）" }));
      }
      await fileSystem.writeFile(destPath, body);
      return Result.ok({ etag });
    },
  };

  return storage;
}
