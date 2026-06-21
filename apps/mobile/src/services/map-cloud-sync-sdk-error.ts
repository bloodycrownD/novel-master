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

function isPathStyleForbiddenError(name: string, lowerMessage: string): boolean {
  return (
    PATH_STYLE_FORBIDDEN_NAMES.has(name) ||
    lowerMessage.includes('virtual hosted style') ||
    lowerMessage.includes('secondleveldomainforbidden')
  );
}

function isAuthError(name: string, lowerMessage: string, httpStatusCode?: number): boolean {
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

function isBucketError(name: string, lowerMessage: string, httpStatusCode?: number): boolean {
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
