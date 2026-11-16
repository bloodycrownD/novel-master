/**
 * 云同步配置持久化：KKV module `nm-cloud-sync` + SKSP `cloud-sync/s3-secret-key`。
 *
 * @module services/cloud-sync-config.store
 */
import { randomUUID } from "node:crypto";
import { normalizePrefix } from "@novel-master/core";
import { isAppError, type AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import type { KkvService } from "@novel-master/core/kkv";
import type { SecretStore } from "@novel-master/core/sksp";

export const CLOUD_SYNC_KKV_MODULE = "nm-cloud-sync";
const CLOUD_SYNC_SKSP_SECRET_REF = "cloud-sync/s3-secret-key";

/** 默认云同步路径前缀 */
export const DEFAULT_CLOUD_SYNC_PATH_PREFIX = "novel-master/sync/";

const CLOUD_SYNC_KEY_ENDPOINT = "endpoint";
const CLOUD_SYNC_KEY_BUCKET = "bucket";
const CLOUD_SYNC_KEY_REGION = "region";
const CLOUD_SYNC_KEY_PATH_PREFIX = "pathPrefix";
const CLOUD_SYNC_KEY_ACCESS_KEY_ID = "accessKeyId";
const CLOUD_SYNC_KEY_FORCE_PATH_STYLE = "forcePathStyle";
const CLOUD_SYNC_KEY_DEVICE_ID = "deviceId";
const CLOUD_SYNC_KEY_DEVICE_LABEL = "deviceLabel";
const CLOUD_SYNC_KEY_ENABLED = "enabled";
const CLOUD_SYNC_KEY_LAST_SYNCED_REV = "lastSyncedRev";
const CLOUD_SYNC_KEY_LAST_PULL_AT = "lastPullAt";
const CLOUD_SYNC_KEY_LAST_PUSH_AT = "lastPushAt";
const CLOUD_SYNC_KEY_LAST_PULL_RESULT = "lastPullResult";
const CLOUD_SYNC_KEY_LAST_PUSH_RESULT = "lastPushResult";

/** 从 KKV 读取的非密钥云同步配置 */
type CloudSyncPublicConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  deviceId: string;
  deviceLabel: string;
  enabledRaw?: string;
  lastSyncedRev: number;
  lastPullAt: string;
  lastPushAt: string;
  lastPullResult: string;
  lastPushResult: string;
};

export type CloudSyncConfigDto = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  deviceId: string;
  deviceLabel: string;
  hasSecretKey: boolean;
  enabled: boolean;
};

export type CloudSyncSetConfigInput = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  deviceLabel?: string;
};

export type CloudSyncLocalMeta = {
  lastSyncedRev: number;
  lastPullAt: string;
  lastPushAt: string;
  lastPullResult: string;
  lastPushResult: string;
};

/**
 * 读侧四个方法（getConfig / setConfig / getPublicConfig / getLocalMeta）经
 * `readPublicConfig` 走 KKV 读取，已知失败沿 `Result` 上行（错误通道迁移四期），
 * 由 DesktopCloudSyncService 内联记账后交给 handlers/cloud-sync.ts 转码；写侧
 * 方法（setEnabled / setLastSyncedRev / recordPull / recordPush）与密钥读取
 * 不经 `readPublicConfig`，维持原形态。
 */
export interface CloudSyncConfigStore {
  getConfig(): Promise<Result<CloudSyncConfigDto, AppError>>;
  setConfig(input: CloudSyncSetConfigInput): Promise<Result<void, AppError>>;
  setEnabled(enabled: boolean): Promise<void>;
  getPublicConfig(): Promise<Result<CloudSyncPublicConfig, AppError>>;
  getSecretAccessKey(): Promise<string | null>;
  getLocalMeta(): Promise<Result<CloudSyncLocalMeta, AppError>>;
  setLastSyncedRev(rev: number): Promise<void>;
  recordPull(success: boolean, detail: string): Promise<void>;
  recordPush(success: boolean, detail: string): Promise<void>;
}

async function kkvGet(kkv: KkvService, key: string): Promise<Result<string | undefined, AppError>> {
  const raw = await kkv.get(CLOUD_SYNC_KKV_MODULE, key);
  if (!raw.ok) {
    if (isAppError(raw.error, "KKV_NOT_FOUND")) {
      return Result.ok(undefined);
    }
    // 非 NOT_FOUND 的 KKV 读失败沿 Result 上行（错误通道迁移四期）：
    // readPublicConfig 聚合 → store 方法 → DesktopCloudSyncService 记账 →
    // handlers/cloud-sync.ts 转码收口。
    return Result.err(raw.error);
  }
  return Result.ok(raw.value);
}

function assertNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
}

export function createCloudSyncConfigStore(kkv: KkvService, secretStore: SecretStore): CloudSyncConfigStore {
  /** 14 个 KKV 键一次并行读齐；任一已知失败整包 err（错误通道迁移四期）。 */
  async function readPublicConfig(): Promise<Result<CloudSyncPublicConfig, AppError>> {
    const readTasks = [
      kkvGet(kkv, CLOUD_SYNC_KEY_ENDPOINT),
      kkvGet(kkv, CLOUD_SYNC_KEY_BUCKET),
      kkvGet(kkv, CLOUD_SYNC_KEY_REGION),
      kkvGet(kkv, CLOUD_SYNC_KEY_PATH_PREFIX),
      kkvGet(kkv, CLOUD_SYNC_KEY_ACCESS_KEY_ID),
      kkvGet(kkv, CLOUD_SYNC_KEY_FORCE_PATH_STYLE),
      kkvGet(kkv, CLOUD_SYNC_KEY_DEVICE_ID),
      kkvGet(kkv, CLOUD_SYNC_KEY_DEVICE_LABEL),
      kkvGet(kkv, CLOUD_SYNC_KEY_ENABLED),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_SYNCED_REV),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PULL_AT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PUSH_AT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PULL_RESULT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PUSH_RESULT),
    ];
    const results = await Promise.all(readTasks);
    for (const r of results) {
      if (!r.ok) return Result.err(r.error);
    }
    const [endpoint, bucket, region, pathPrefix, accessKeyId, forcePathStyle, deviceId, deviceLabel, enabledRaw, lastSyncedRev, lastPullAt, lastPushAt, lastPullResult, lastPushResult] = results.map(
      (r) => (r.ok ? r.value : undefined)
    );
    const parsedLastSyncedRev = lastSyncedRev == null || lastSyncedRev.trim() === "" ? 0 : Number.parseInt(lastSyncedRev, 10);

    return Result.ok({
      endpoint: endpoint ?? "",
      bucket: bucket ?? "",
      region: region ?? "",
      pathPrefix: pathPrefix ?? DEFAULT_CLOUD_SYNC_PATH_PREFIX,
      accessKeyId: accessKeyId ?? "",
      forcePathStyle: forcePathStyle === "true",
      deviceId: deviceId ?? "",
      deviceLabel: deviceLabel ?? "",
      enabledRaw,
      lastSyncedRev: Number.isFinite(parsedLastSyncedRev) && parsedLastSyncedRev >= 0 ? parsedLastSyncedRev : 0,
      lastPullAt: lastPullAt ?? "",
      lastPushAt: lastPushAt ?? "",
      lastPullResult: lastPullResult ?? "",
      lastPushResult: lastPushResult ?? "",
    });
  }

  return {
    async getConfig() {
      const publicConfig = await readPublicConfig();
      if (!publicConfig.ok) return Result.err(publicConfig.error);
      const hasSecretKey = await secretStore.has(CLOUD_SYNC_SKSP_SECRET_REF);
      return Result.ok({
        endpoint: publicConfig.value.endpoint,
        bucket: publicConfig.value.bucket,
        region: publicConfig.value.region,
        pathPrefix: publicConfig.value.pathPrefix,
        accessKeyId: publicConfig.value.accessKeyId,
        forcePathStyle: publicConfig.value.forcePathStyle,
        deviceId: publicConfig.value.deviceId,
        deviceLabel: publicConfig.value.deviceLabel,
        hasSecretKey,
        enabled: publicConfig.value.enabledRaw === "true",
      });
    },

    async setEnabled(enabled: boolean) {
      await kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENABLED, enabled ? "true" : "false");
    },

    async setConfig(input) {
      assertNonEmpty("Endpoint", input.endpoint);
      assertNonEmpty("Bucket", input.bucket);
      assertNonEmpty("Access Key", input.accessKeyId);

      const existing = await readPublicConfig();
      if (!existing.ok) return Result.err(existing.error);
      const hasSecret = await secretStore.has(CLOUD_SYNC_SKSP_SECRET_REF);
      const secret = input.secretAccessKey?.trim() ?? "";
      if (!hasSecret && secret.length === 0) {
        throw new Error("Secret Key 不能为空");
      }

      const deviceId = existing.value.deviceId.trim().length > 0 ? existing.value.deviceId : randomUUID();

      const normalizedPrefix = normalizePrefix(input.pathPrefix.trim() || DEFAULT_CLOUD_SYNC_PATH_PREFIX);

      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENDPOINT, input.endpoint.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_BUCKET, input.bucket.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_REGION, input.region.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_PATH_PREFIX, normalizedPrefix),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ACCESS_KEY_ID, input.accessKeyId.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_FORCE_PATH_STYLE, input.forcePathStyle ? "true" : "false"),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_DEVICE_ID, deviceId),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_DEVICE_LABEL, (input.deviceLabel ?? existing.value.deviceLabel).trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENABLED, "true"),
      ]);

      if (secret.length > 0) {
        await secretStore.set(CLOUD_SYNC_SKSP_SECRET_REF, secret);
      }
      return Result.ok(undefined);
    },

    async getPublicConfig() {
      return readPublicConfig();
    },

    async getSecretAccessKey() {
      return secretStore.get(CLOUD_SYNC_SKSP_SECRET_REF);
    },

    async getLocalMeta() {
      const cfg = await readPublicConfig();
      if (!cfg.ok) return Result.err(cfg.error);
      return Result.ok({
        lastSyncedRev: cfg.value.lastSyncedRev,
        lastPullAt: cfg.value.lastPullAt,
        lastPushAt: cfg.value.lastPushAt,
        lastPullResult: cfg.value.lastPullResult,
        lastPushResult: cfg.value.lastPushResult,
      });
    },

    async setLastSyncedRev(rev) {
      await kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_SYNCED_REV, String(rev));
    },

    async recordPull(success, detail) {
      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PULL_AT, new Date().toISOString()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PULL_RESULT, `${success ? "成功" : "失败"}：${detail}`),
      ]);
    },

    async recordPush(success, detail) {
      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PUSH_AT, new Date().toISOString()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PUSH_RESULT, `${success ? "成功" : "失败"}：${detail}`),
      ]);
    },
  };
}
