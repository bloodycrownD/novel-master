/**
 * React Native 专用 S3Client：注入兼容 FetchHttpHandler，修复响应体为 Node Readable 时的反序列化失败。
 *
 * @module shims/aws-rn-s3-client
 */
import {S3Client, type S3ClientConfig} from '@aws-sdk/client-s3';
import type {FetchHttpHandler} from '@smithy/fetch-http-handler';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {RnFetchHttpHandler} = require('./aws-rn-fetch-handler') as {
  RnFetchHttpHandler: new (options?: object) => FetchHttpHandler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {createRnStreamCollector} = require('./aws-rn-stream-collector') as {
  createRnStreamCollector: () => NonNullable<S3ClientConfig['streamCollector']>;
};

/** 组装 RN 兼容的 S3Client 配置。 */
export function createRnS3ClientConfig(
  config: S3StorageConfig,
): S3ClientConfig {
  return {
    region: config.region || 'us-east-1',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
    requestHandler: new RnFetchHttpHandler({requestTimeout: 300_000}),
    streamCollector: createRnStreamCollector(),
  };
}

/** 创建 RN 兼容 S3Client（云同步测试连接 / Pull / Push 共用）。 */
export function createRnS3Client(config: S3StorageConfig): S3Client {
  return new S3Client(createRnS3ClientConfig(config));
}
