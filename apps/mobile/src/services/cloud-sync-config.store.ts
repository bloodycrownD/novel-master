/**
 * 云同步配置：KKV `nm-cloud-sync` 存非密钥字段，SKSP 存 Secret Access Key。
 *
 * @module services/cloud-sync-config.store
 */
import {KkvError, normalizePrefix} from '@novel-master/core';
import type {KkvService} from '@novel-master/core/kkv';
import { type SecretStore } from "@novel-master/core/provider";
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** KKV 模块名 */
export const CLOUD_SYNC_KKV_MODULE = 'nm-cloud-sync';

/** SKSP 引用：S3 Secret Access Key */
export const CLOUD_SYNC_SECRET_REF = 'cloud-sync/s3-secret-key';

/** 默认路径前缀 */
export const DEFAULT_CLOUD_SYNC_PATH_PREFIX = 'novel-master/sync/';

const KEY_ENDPOINT = 'endpoint';
const KEY_BUCKET = 'bucket';
const KEY_REGION = 'region';
const KEY_PATH_PREFIX = 'pathPrefix';
const KEY_ACCESS_KEY_ID = 'accessKeyId';
const KEY_FORCE_PATH_STYLE = 'forcePathStyle';
const KEY_DEVICE_ID = 'deviceId';
const KEY_DEVICE_LABEL = 'deviceLabel';
const KEY_LAST_SYNCED_REV = 'lastSyncedRev';
const KEY_LAST_PULL_AT = 'lastPullAt';
const KEY_LAST_PUSH_AT = 'lastPushAt';
const KEY_LAST_PULL_RESULT = 'lastPullResult';
const KEY_LAST_PUSH_RESULT = 'lastPushResult';

/** 保存配置时的输入（含明文 SK，仅写入时短暂存在内存） */
export type CloudSyncConfigInput = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  deviceLabel?: string;
};

/** 对外展示的配置（不含 SK 明文） */
export type CloudSyncConfigPublic = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  deviceId: string;
  deviceLabel?: string;
  secretKeySet: boolean;
};

/** 本机同步状态（不含云端 rev，由 service 另行读取） */
export type CloudSyncLocalStatus = {
  configured: boolean;
  deviceId: string;
  lastSyncedRev: number;
  lastPullAt?: string;
  lastPushAt?: string;
  lastPullResult?: string;
  lastPushResult?: string;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === '') {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

function parseRev(raw: string | undefined): number {
  if (raw == null || raw === '') {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function kkvGet(
  kkv: KkvService,
  key: string,
): Promise<string | undefined> {
  try {
    return await kkv.get(CLOUD_SYNC_KKV_MODULE, key);
  } catch (error) {
    if (error instanceof KkvError && error.code === 'NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

async function kkvSet(
  kkv: KkvService,
  key: string,
  value: string,
): Promise<void> {
  await kkv.set(CLOUD_SYNC_KKV_MODULE, key, value);
}

type RandomCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

function readWebCrypto(): RandomCrypto | undefined {
  return (globalThis as {crypto?: RandomCrypto}).crypto;
}

/** 生成设备 ID（首次保存配置时写入 KKV） */
export function generateCloudSyncDeviceId(): string {
  const cryptoApi = readWebCrypto();
  if (cryptoApi != null && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues != null) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateConfigInput(input: CloudSyncConfigInput): void {
  if (!input.endpoint.trim()) {
    throw new Error('请填写 Endpoint');
  }
  if (!input.bucket.trim()) {
    throw new Error('请填写 Bucket');
  }
  if (!input.accessKeyId.trim()) {
    throw new Error('请填写 Access Key');
  }
  if (!input.secretAccessKey.trim()) {
    throw new Error('请填写 Secret Key');
  }
}

/** 读取对外配置；未配置时 endpoint 等为空串。 */
export async function getCloudSyncConfig(
  runtime: MobileNovelMasterRuntime,
): Promise<CloudSyncConfigPublic> {
  const {kkv, secretStore} = runtime;
  const [
    endpoint,
    bucket,
    region,
    pathPrefix,
    accessKeyId,
    forcePathStyle,
    deviceId,
    deviceLabel,
  ] = await Promise.all([
    kkvGet(kkv, KEY_ENDPOINT),
    kkvGet(kkv, KEY_BUCKET),
    kkvGet(kkv, KEY_REGION),
    kkvGet(kkv, KEY_PATH_PREFIX),
    kkvGet(kkv, KEY_ACCESS_KEY_ID),
    kkvGet(kkv, KEY_FORCE_PATH_STYLE),
    kkvGet(kkv, KEY_DEVICE_ID),
    kkvGet(kkv, KEY_DEVICE_LABEL),
  ]);

  const secretKeySet = await secretStore.has(CLOUD_SYNC_SECRET_REF);

  return {
    endpoint: endpoint ?? '',
    bucket: bucket ?? '',
    region: region ?? '',
    pathPrefix: pathPrefix ?? DEFAULT_CLOUD_SYNC_PATH_PREFIX,
    accessKeyId: accessKeyId ?? '',
    forcePathStyle: parseBool(forcePathStyle, false),
    deviceId: deviceId ?? '',
    deviceLabel: deviceLabel?.trim() || undefined,
    secretKeySet,
  };
}

/** 读取本机同步状态字段。 */
export async function getCloudSyncLocalStatus(
  runtime: MobileNovelMasterRuntime,
): Promise<CloudSyncLocalStatus> {
  const config = await getCloudSyncConfig(runtime);
  const {kkv} = runtime;
  const [lastSyncedRev, lastPullAt, lastPushAt, lastPullResult, lastPushResult] =
    await Promise.all([
      kkvGet(kkv, KEY_LAST_SYNCED_REV),
      kkvGet(kkv, KEY_LAST_PULL_AT),
      kkvGet(kkv, KEY_LAST_PUSH_AT),
      kkvGet(kkv, KEY_LAST_PULL_RESULT),
      kkvGet(kkv, KEY_LAST_PUSH_RESULT),
    ]);

  const configured =
    config.endpoint.trim().length > 0 &&
    config.bucket.trim().length > 0 &&
    config.accessKeyId.trim().length > 0 &&
    config.secretKeySet &&
    config.deviceId.trim().length > 0;

  return {
    configured,
    deviceId: config.deviceId,
    lastSyncedRev: parseRev(lastSyncedRev),
    lastPullAt: lastPullAt ?? undefined,
    lastPushAt: lastPushAt ?? undefined,
    lastPullResult: lastPullResult ?? undefined,
    lastPushResult: lastPushResult ?? undefined,
  };
}

/** 保存配置：校验非空、生成 deviceId（若缺）、SK 写 SKSP。 */
export async function setCloudSyncConfig(
  runtime: MobileNovelMasterRuntime,
  input: CloudSyncConfigInput,
): Promise<CloudSyncConfigPublic> {
  validateConfigInput(input);
  const {kkv, secretStore} = runtime;

  let deviceId = (await kkvGet(kkv, KEY_DEVICE_ID))?.trim() ?? '';
  if (!deviceId) {
    deviceId = generateCloudSyncDeviceId();
  }

  const normalizedPrefix = normalizePrefix(
    input.pathPrefix.trim() || DEFAULT_CLOUD_SYNC_PATH_PREFIX,
  );

  await Promise.all([
    kkvSet(kkv, KEY_ENDPOINT, input.endpoint.trim()),
    kkvSet(kkv, KEY_BUCKET, input.bucket.trim()),
    kkvSet(kkv, KEY_REGION, input.region.trim()),
    kkvSet(kkv, KEY_PATH_PREFIX, normalizedPrefix),
    kkvSet(kkv, KEY_ACCESS_KEY_ID, input.accessKeyId.trim()),
    kkvSet(kkv, KEY_FORCE_PATH_STYLE, input.forcePathStyle ? 'true' : 'false'),
    kkvSet(kkv, KEY_DEVICE_ID, deviceId),
    secretStore.set(CLOUD_SYNC_SECRET_REF, input.secretAccessKey.trim()),
  ]);

  const label = input.deviceLabel?.trim();
  if (label) {
    await kkvSet(kkv, KEY_DEVICE_LABEL, label);
  }

  return getCloudSyncConfig(runtime);
}

/** 更新本机 Pull/Push 结果与时间戳。 */
export async function patchCloudSyncLocalStatus(
  runtime: MobileNovelMasterRuntime,
  patch: {
    lastSyncedRev?: number;
    lastPullAt?: string;
    lastPushAt?: string;
    lastPullResult?: string;
    lastPushResult?: string;
  },
): Promise<void> {
  const {kkv} = runtime;
  const tasks: Promise<void>[] = [];
  if (patch.lastSyncedRev != null) {
    tasks.push(
      kkvSet(kkv, KEY_LAST_SYNCED_REV, String(patch.lastSyncedRev)),
    );
  }
  if (patch.lastPullAt != null) {
    tasks.push(kkvSet(kkv, KEY_LAST_PULL_AT, patch.lastPullAt));
  }
  if (patch.lastPushAt != null) {
    tasks.push(kkvSet(kkv, KEY_LAST_PUSH_AT, patch.lastPushAt));
  }
  if (patch.lastPullResult != null) {
    tasks.push(kkvSet(kkv, KEY_LAST_PULL_RESULT, patch.lastPullResult));
  }
  if (patch.lastPushResult != null) {
    tasks.push(kkvSet(kkv, KEY_LAST_PUSH_RESULT, patch.lastPushResult));
  }
  await Promise.all(tasks);
}

/** 读取 SK 明文（仅 service 内部组装 S3 配置时使用）。 */
export async function readCloudSyncSecretKey(
  secretStore: SecretStore,
): Promise<string | null> {
  return secretStore.get(CLOUD_SYNC_SECRET_REF);
}

/** 由已存配置组装 S3 驱动配置；未配置完整时抛错。 */
export async function buildS3StorageConfig(
  runtime: MobileNovelMasterRuntime,
  overrides?: Partial<CloudSyncConfigInput>,
): Promise<S3StorageConfig> {
  const config = await getCloudSyncConfig(runtime);
  const secretKey =
    overrides?.secretAccessKey?.trim() ||
    (await readCloudSyncSecretKey(runtime.secretStore));
  if (
    !config.endpoint.trim() ||
    !config.bucket.trim() ||
    !config.accessKeyId.trim() ||
    !secretKey
  ) {
    throw new Error('请先完成云存储配置');
  }

  return {
    endpoint: overrides?.endpoint?.trim() || config.endpoint.trim(),
    bucket: overrides?.bucket?.trim() || config.bucket.trim(),
    region: overrides?.region?.trim() ?? config.region.trim(),
    accessKeyId:
      overrides?.accessKeyId?.trim() || config.accessKeyId.trim(),
    secretAccessKey: secretKey,
    forcePathStyle:
      overrides?.forcePathStyle ?? config.forcePathStyle,
  };
}
