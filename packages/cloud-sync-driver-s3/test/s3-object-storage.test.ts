import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { CloudSyncError } from "@novel-master/core";
import { createS3ObjectStorage, isAliyunOssEndpoint } from "../src/create-s3-object-storage.js";
import type { S3StorageConfig } from "../src/s3-config.js";

const testConfig: S3StorageConfig = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  forcePathStyle: true,
};

type SentCommand = HeadObjectCommand | GetObjectCommand | PutObjectCommand;

function createMockClient(
  handler: (command: SentCommand) => Promise<unknown>,
): S3Client {
  return { send: handler } as unknown as S3Client;
}

describe("createS3ObjectStorage", () => {
  it("head：对象存在时返回 etag 与字节数（无引号）", async () => {
    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof HeadObjectCommand);
        assert.equal(command.input.Bucket, "test-bucket");
        assert.equal(command.input.Key, "status.json");
        return { ETag: '"abc123"', ContentLength: 42 };
      }),
    });

    const result = await storage.head("status.json");
    assert.deepEqual(result, { exists: true, etag: "abc123", bytes: 42 });
  });

  it("head：对象不存在时返回 exists=false", async () => {
    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async () => {
        throw new NotFound({ message: "Not Found", $metadata: {} });
      }),
    });

    const result = await storage.head("missing.json");
    assert.deepEqual(result, { exists: false });
  });

  it("get：返回 body 与无引号 etag", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof GetObjectCommand);
        return {
          ETag: '"etag-get"',
          Body: {
            transformToByteArray: async () => payload,
          },
        };
      }),
    });

    const result = await storage.get("snapshots/rev-000001.nmbackup");
    assert.deepEqual(result.body, payload);
    assert.equal(result.etag, "etag-get");
  });

  it("put：透传 If-Match / If-None-Match 并返回 etag", async () => {
    const body = new Uint8Array([9, 8, 7]);
    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof PutObjectCommand);
        assert.equal(command.input.Bucket, "test-bucket");
        assert.equal(command.input.Key, "status.json");
        assert.equal(command.input.IfMatch, "prev-etag");
        assert.equal(command.input.IfNoneMatch, "*");
        assert.deepEqual(command.input.Body, body);
        return { ETag: '"new-etag"' };
      }),
    });

    const result = await storage.put("status.json", body, {
      ifMatch: "prev-etag",
      ifNoneMatch: "*",
    });
    assert.equal(result.etag, "new-etag");
  });

  it("CS-S1: put If-Match 冲突映射为 LOCK_CONTENTION", async () => {
    const preconditionFailed = Object.assign(new Error("Precondition Failed"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });

    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof PutObjectCommand);
        assert.equal(command.input.IfMatch, "stale-etag");
        throw preconditionFailed;
      }),
    });

    await assert.rejects(
      () =>
        storage.put("status.json", new Uint8Array([1]), {
          ifMatch: "stale-etag",
        }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "LOCK_CONTENTION");
        return true;
      },
    );
  });

  it("阿里云 OSS：条件 PUT 改为 Head 校验 etag，不传 If-Match", async () => {
    const ossConfig: S3StorageConfig = {
      ...testConfig,
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
    };
    const body = new Uint8Array([1, 2, 3]);
    let headCalls = 0;

    const storage = createS3ObjectStorage(ossConfig, {
      client: createMockClient(async (command) => {
        if (command instanceof HeadObjectCommand) {
          headCalls += 1;
          return { ETag: '"current-etag"', ContentLength: 10 };
        }
        assert.ok(command instanceof PutObjectCommand);
        assert.equal(command.input.IfMatch, undefined);
        assert.equal(command.input.IfNoneMatch, undefined);
        return { ETag: '"new-etag"' };
      }),
    });

    const result = await storage.put("status.json", body, {
      ifMatch: "current-etag",
    });
    assert.equal(result.etag, "new-etag");
    assert.equal(headCalls, 1);
  });

  it("阿里云 OSS：If-Match 与远端 etag 不一致时抛 LOCK_CONTENTION", async () => {
    const ossConfig: S3StorageConfig = {
      ...testConfig,
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
    };
    let putCalls = 0;

    const storage = createS3ObjectStorage(ossConfig, {
      client: createMockClient(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return { ETag: '"other-etag"', ContentLength: 10 };
        }
        putCalls += 1;
        return { ETag: '"new-etag"' };
      }),
    });

    await assert.rejects(
      () =>
        storage.put("status.json", new Uint8Array([1]), {
          ifMatch: "expected-etag",
        }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "LOCK_CONTENTION");
        return true;
      },
    );
    assert.equal(putCalls, 0);
  });

  it("putFile：从本地文件读取并上传", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const filePath = join(tmpdir(), `s3-put-file-${Date.now()}.bin`);
    const payload = new Uint8Array([4, 5, 6]);
    await writeFile(filePath, payload);

    try {
      const storage = createS3ObjectStorage(testConfig, {
        client: createMockClient(async (command) => {
          assert.ok(command instanceof PutObjectCommand);
          assert.deepEqual(command.input.Body, payload);
          return { ETag: '"file-etag"' };
        }),
      });

      const result = await storage.putFile!("snapshots/test.nmbackup", filePath);
      assert.equal(result.etag, "file-etag");
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  });

  it("getToPath：下载并写入本地文件", async () => {
    const { readFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const destPath = join(tmpdir(), `s3-get-to-path-${Date.now()}.bin`);
    const payload = new Uint8Array([7, 8, 9]);

    const storage = createS3ObjectStorage(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof GetObjectCommand);
        return {
          ETag: '"get-path-etag"',
          Body: { transformToByteArray: async () => payload },
        };
      }),
    });

    try {
      const result = await storage.getToPath!("snapshots/test.nmbackup", destPath);
      assert.equal(result.etag, "get-path-etag");
      const onDisk = await readFile(destPath);
      assert.deepEqual(new Uint8Array(onDisk), payload);
    } finally {
      await unlink(destPath).catch(() => undefined);
    }
  });
});

describe("isAliyunOssEndpoint", () => {
  it("识别阿里云 OSS 官方 endpoint", () => {
    assert.equal(
      isAliyunOssEndpoint("https://oss-cn-beijing.aliyuncs.com"),
      true,
    );
    assert.equal(isAliyunOssEndpoint("oss-cn-shanghai.aliyuncs.com"), true);
    assert.equal(isAliyunOssEndpoint("https://s3.example.com"), false);
  });
});
