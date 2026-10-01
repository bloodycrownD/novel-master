/**
 * AWS SDK / Smithy 原始错误 → 用户可读 {@link CloudSyncError}。
 * 规则对齐 Desktop `mapStorageError`，并扩展 Smithy 错误名与反序列化兜底。
 *
 * @module services/map-cloud-sync-sdk-error
 */
import {CloudSyncError, isCloudSyncError} from '@novel-master/core';

const AUTH_MESSAGE = '云存储凭据无效或权限不足';
const BUCKET_MESSAGE = '无法访问该存储桶，请检查 Bucket 名称';
const CONNECTION_MESSAGE = '无法连接云存储，请检查网络与 Endpoint';
const FALLBACK_MESSAGE = '云存储连接失败，请检查网络与配置';
const NOT_CONFIGURED_MESSAGE = '请先完成云存储配置';

const AUTH_ERROR_NAMES = new Set([
  'CredentialsProviderError',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
]);

const BUCKET_ERROR_NAMES = new Set(['NoSuchBucket', 'NotFound']);

const PATH_STYLE_FORBIDDEN_NAMES = new Set(['SecondLevelDomainForbidden']);

const PATH_STYLE_MESSAGE =
  '阿里云 OSS 请关闭 Path style；Endpoint 建议使用 https://oss-cn-xxx.aliyuncs.com';

function readErrorName(error: unknown): string {
  if (typeof error === 'object' && error != null && 'name' in error) {
    return String((error as {name: string}).name);
  }
  return '';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取 Smithy 错误的 HTTP 状态码（若存在）。 */
function readHttpStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error == null || !('$metadata' in error)) {
    return undefined;
  }
  const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata;
  const statusCode = metadata?.httpStatusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function isPathStyleForbiddenError(
  name: string,
  lowerMessage: string,
): boolean {
  return (
    PATH_STYLE_FORBIDDEN_NAMES.has(name) ||
    lowerMessage.includes('virtual hosted style') ||
    lowerMessage.includes('secondleveldomainforbidden')
  );
}

function isAuthError(
  name: string,
  lowerMessage: string,
  httpStatusCode?: number,
): boolean {
  if (isPathStyleForbiddenError(name, lowerMessage)) {
    return false;
  }
  return (
    AUTH_ERROR_NAMES.has(name) ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('invalidaccesskeyid') ||
    lowerMessage.includes('signaturedoesnotmatch') ||
    lowerMessage.includes('403') ||
    httpStatusCode === 403
  );
}

function isBucketError(
  name: string,
  lowerMessage: string,
  httpStatusCode?: number,
): boolean {
  return (
    BUCKET_ERROR_NAMES.has(name) ||
    lowerMessage.includes('nosuchbucket') ||
    lowerMessage.includes('404') ||
    httpStatusCode === 404
  );
}

function isConnectionError(lowerMessage: string): boolean {
  return (
    lowerMessage.includes('network') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound')
  );
}

/**
 * 「配置没填全」的错误——它与网络毫无关系。
 *
 * `buildS3StorageConfig` 在 secret 明文为空时抛的就是这条，历史上它会一路
 * 落到兜底分支被包成 `NETWORK / '云存储连接失败，请检查网络与配置'`，
 * 把用户引到「去检查网络」这个完全无关的方向上。S-CS-04 修好令牌边界之后
 * 这类错误第一次真的进了 `catch`（原先它在 try 之外，是裸原始错误），
 * 所以必须在这里归一到 `NOT_CONFIGURED`。
 */
function isNotConfiguredMessage(message: string): boolean {
  return (
    message.includes(NOT_CONFIGURED_MESSAGE) ||
    message.includes('请先配置云存储')
  );
}

function isTechnicalFallbackError(name: string, lowerMessage: string): boolean {
  return (
    name === 'ReferenceError' ||
    name === 'TypeError' ||
    lowerMessage.includes('domparser') ||
    lowerMessage.includes('deserialization') ||
    lowerMessage.includes('referenceerror') ||
    lowerMessage.includes('undefined is not a function')
  );
}

/**
 * 将 AWS SDK / Smithy 抛出的未知错误映射为 {@link CloudSyncError}。
 * 已有 {@link CloudSyncError}（如 `NOT_CONFIGURED`）原样透传。
 */
export function mapCloudSyncSdkError(error: unknown): CloudSyncError {
  if (isCloudSyncError(error)) {
    return error;
  }

  const name = readErrorName(error);
  const message = readErrorMessage(error);
  const lowerMessage = message.toLowerCase();
  const httpStatusCode = readHttpStatusCode(error);

  if (isPathStyleForbiddenError(name, lowerMessage)) {
    return new CloudSyncError('NETWORK', PATH_STYLE_MESSAGE, {cause: error});
  }

  // 判定放在 auth / bucket / connection 之前：这些原生异常里也可能带
  // 「配置不全」的措辞，但对用户而言根因就是配置。
  if (isNotConfiguredMessage(message)) {
    return new CloudSyncError('NOT_CONFIGURED', message, {cause: error});
  }

  if (isAuthError(name, lowerMessage, httpStatusCode)) {
    return new CloudSyncError('AUTH', AUTH_MESSAGE, {cause: error});
  }

  if (isBucketError(name, lowerMessage, httpStatusCode)) {
    return new CloudSyncError('NETWORK', BUCKET_MESSAGE, {cause: error});
  }

  if (isConnectionError(lowerMessage)) {
    return new CloudSyncError('NETWORK', CONNECTION_MESSAGE, {cause: error});
  }

  if (isTechnicalFallbackError(name, lowerMessage)) {
    return new CloudSyncError('NETWORK', FALLBACK_MESSAGE, {cause: error});
  }

  return new CloudSyncError('NETWORK', FALLBACK_MESSAGE, {cause: error});
}
