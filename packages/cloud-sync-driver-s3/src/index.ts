export type { S3StorageConfig } from "./s3-config.js";
export {
  createS3ObjectStorage,
  normalizeEtag,
} from "./create-s3-object-storage.js";
export type { S3ObjectStorageDeps } from "./create-s3-object-storage.js";
export type {
  ObjectStorageHeadResult,
  ObjectStoragePort,
} from "./object-storage.port.js";
