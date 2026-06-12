import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createS3ObjectStorage } from "../src/create-s3-object-storage.js";
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

  it("put：If-Match 冲突时原样抛出 SDK 错误", async () => {
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
        assert.equal(
          (error as { name?: string }).name,
          "PreconditionFailed",
        );
        return true;
      },
    );
  });
});
