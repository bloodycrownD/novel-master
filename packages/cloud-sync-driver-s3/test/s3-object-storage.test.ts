import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { AppErrorOps } from "@novel-master/core/errors";
import { S3ObjectStorage } from "../src/create-s3-object-storage.js";
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

describe("S3ObjectStorage.create", () => {
  it("head：对象存在时返回 etag 与字节数（无引号）", async () => {
    const storage = S3ObjectStorage.create(testConfig, {
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
    const storage = S3ObjectStorage.create(testConfig, {
      client: createMockClient(async () => {
        throw new NotFound({ message: "Not Found", $metadata: {} });
      }),
    });

    const result = await storage.head("missing.json");
    assert.deepEqual(result, { exists: false });
  });

  it("get：返回 body 与无引号 etag", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    const storage = S3ObjectStorage.create(testConfig, {
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
    const storage = S3ObjectStorage.create(testConfig, {
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
    // 错误通道迁移五期：put 走 Result 通道，失败沿返回值上递。
    assert.ok(result.ok, "put 应成功");
    assert.equal(result.value.etag, "new-etag");
  });

  it("CS-S1: put If-Match 冲突映射为 LOCK_CONTENTION", async () => {
    const preconditionFailed = Object.assign(new Error("Precondition Failed"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });

    const storage = S3ObjectStorage.create(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof PutObjectCommand);
        assert.equal(command.input.IfMatch, "stale-etag");
        throw preconditionFailed;
      }),
    });

    const result = await storage.put("status.json", new Uint8Array([1]), {
      ifMatch: "stale-etag",
    });
    // 错误通道迁移五期 + 三期：失败走 Result 通道，收敛为 AppError + 码表 key。
    assert.ok(!result.ok, "If-Match 冲突应走 Err 通道");
    if (!result.ok) {
      assert.ok(AppErrorOps.is(result.error, "CLOUD_SYNC_LOCK_CONTENTION"));
    }
  });

  it("阿里云 OSS：条件 PUT 改为 Head 校验 etag，不传 If-Match", async () => {
    const ossConfig: S3StorageConfig = {
      ...testConfig,
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
    };
    const body = new Uint8Array([1, 2, 3]);
    let headCalls = 0;

    const storage = S3ObjectStorage.create(ossConfig, {
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
    // 错误通道迁移五期：put 走 Result 通道。
    assert.ok(result.ok, "OSS 条件 PUT 应成功");
    assert.equal(result.value.etag, "new-etag");
    assert.equal(headCalls, 1);
  });

  it("阿里云 OSS：If-Match 与远端 etag 不一致时报 LOCK_CONTENTION", async () => {
    const ossConfig: S3StorageConfig = {
      ...testConfig,
      endpoint: "https://oss-cn-beijing.aliyuncs.com",
    };
    let putCalls = 0;

    const storage = S3ObjectStorage.create(ossConfig, {
      client: createMockClient(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return { ETag: '"other-etag"', ContentLength: 10 };
        }
        putCalls += 1;
        return { ETag: '"new-etag"' };
      }),
    });

    const result = await storage.put("status.json", new Uint8Array([1]), {
      ifMatch: "expected-etag",
    });
    // 错误通道迁移五期 + 三期：失败走 Result 通道，收敛为 AppError + 码表 key。
    assert.ok(!result.ok, "If-Match 不一致应走 Err 通道");
    if (!result.ok) {
      assert.ok(AppErrorOps.is(result.error, "CLOUD_SYNC_LOCK_CONTENTION"));
    }
    assert.equal(putCalls, 0);
  });

  it("putFile：从本地文件读取并上传", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const filePath = join(tmpdir(), `s3-put-file-${Date.now()}.bin`);
    const payload = new Uint8Array([4, 5, 6]);
    await writeFile(filePath, payload);
    // 哨兵实例：readFile 返回它，断言上传的 Body **就是同一个对象**。
    // `new Uint8Array(raw)` 是逐元素复制，会让这条断言红；把它删掉或反过来
    // 「总是拷贝」也都红 ⇒ 有牙。内容断言（deepEqual）同时保留，两条一起在
    // 才同时证明「字节内容没变」与「没有额外分配」。
    const sentinel = new Uint8Array([4, 5, 6]);

    try {
      const storage = S3ObjectStorage.create(testConfig, {
        client: createMockClient(async (command) => {
          assert.ok(command instanceof PutObjectCommand);
          assert.deepEqual(command.input.Body, payload);
          // 引用相等（===），不是 deepEqual：钉住 putFile 去掉的那层多余整拷。
          assert.equal(command.input.Body, sentinel);
          return { ETag: '"file-etag"' };
        }),
        // Node 端注入基于 node:fs/promises 的 FileSystemPort（A-26）。
        fileSystem: {
          readFile: () => Promise.resolve(sentinel),
          writeFile: (path, bytes) => writeFile(path, bytes),
        },
      });

      const result = await storage.putFile!("snapshots/test.nmbackup", filePath);
      // 错误通道迁移五期：putFile 走 Result 通道。
      assert.ok(result.ok, "putFile 应成功");
      assert.equal(result.value.etag, "file-etag");
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  });

  it("getToPath：下载并写入本地文件", async () => {
    const { readFile, writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const destPath = join(tmpdir(), `s3-get-to-path-${Date.now()}.bin`);
    const payload = new Uint8Array([7, 8, 9]);

    const storage = S3ObjectStorage.create(testConfig, {
      client: createMockClient(async (command) => {
        assert.ok(command instanceof GetObjectCommand);
        return {
          ETag: '"get-path-etag"',
          Body: { transformToByteArray: async () => payload },
        };
      }),
      // Node 端注入基于 node:fs/promises 的 FileSystemPort（A-26）。
      fileSystem: {
        readFile: (path) => readFile(path),
        writeFile: (path, bytes) => writeFile(path, bytes),
      },
    });

    try {
      const result = await storage.getToPath!("snapshots/test.nmbackup", destPath);
      // 错误通道迁移五期：getToPath 走 Result 通道。
      assert.ok(result.ok, "getToPath 应成功");
      assert.equal(result.value.etag, "get-path-etag");
      const onDisk = await readFile(destPath);
      assert.deepEqual(new Uint8Array(onDisk), payload);
    } finally {
      await unlink(destPath).catch(() => undefined);
    }
  });
});

describe("S3ObjectStorage.isAliyunOssEndpoint", () => {
  it("识别阿里云 OSS 官方 endpoint", () => {
    assert.equal(
      S3ObjectStorage.isAliyunOssEndpoint("https://oss-cn-beijing.aliyuncs.com"),
      true,
    );
    assert.equal(S3ObjectStorage.isAliyunOssEndpoint("oss-cn-shanghai.aliyuncs.com"), true);
    assert.equal(S3ObjectStorage.isAliyunOssEndpoint("https://s3.example.com"), false);
  });
});
