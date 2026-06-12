/**
 * S3 兼容对象存储连接配置。
 */
export type S3StorageConfig = {
  /** 含 https:// 的端点 URL */
  endpoint: string;
  /** 区域；MinIO 等可传空串 */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO / 部分 OSS 需开启路径风格 */
  forcePathStyle?: boolean;
};
