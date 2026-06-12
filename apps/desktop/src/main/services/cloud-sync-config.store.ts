/**
 * 云同步配置持久化：KKV module `nm-cloud-sync` + SKSP `cloud-sync/s3-secret-key`。
 *
 * @module services/cloud-sync-config.store
 */
import { randomUUID } from "node:crypto";
import { KkvError } from "@novel-master/core";
import type { KkvService } from "@novel-master/core/kkv";
import type { SecretStore } from "@novel-master/core/sksp";

export const CLOUD_SYNC_KKV_MODULE = "nm-cloud-sync";
export const CLOUD_SYNC_SKSP_SECRET_REF = "cloud-sync/s3-secret-key";

export const CLOUD_SYNC_KEY_ENDPOINT = "endpoint";
export const CLOUD_SYNC_KEY_BUCKET = "bucket";
export const CLOUD_SYNC_KEY_REGION = "region";
export const CLOUD_SYNC_KEY_PATH_PREFIX = "pathPrefix";
export const CLOUD_SYNC_KEY_ACCESS_KEY_ID = "accessKeyId";
export const CLOUD_SYNC_KEY_FORCE_PATH_STYLE = "forcePathStyle";
export const CLOUD_SYNC_KEY_DEVICE_ID = "deviceId";
export const CLOUD_SYNC_KEY_DEVICE_LABEL = "deviceLabel";
export const CLOUD_SYNC_KEY_LAST_SYNCED_REV = "lastSyncedRev";
export const CLOUD_SYNC_KEY_LAST_PULL_AT = "lastPullAt";
export const CLOUD_SYNC_KEY_LAST_PUSH_AT = "lastPushAt";
export const CLOUD_SYNC_KEY_LAST_PULL_RESULT = "lastPullResult";
export const CLOUD_SYNC_KEY_LAST_PUSH_RESULT = "lastPushResult";

/** 从 KKV 读取的非密钥云同步配置 */
export type CloudSyncPublicConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  pathPrefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  deviceId: string;
  deviceLabel: string;
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

export interface CloudSyncConfigStore {
  getConfig(): Promise<CloudSyncConfigDto>;
  setConfig(input: CloudSyncSetConfigInput): Promise<void>;
  getPublicConfig(): Promise<CloudSyncPublicConfig>;
  getSecretAccessKey(): Promise<string | null>;
  getLocalMeta(): Promise<CloudSyncLocalMeta>;
  setLastSyncedRev(rev: number): Promise<void>;
  recordPull(success: boolean, detail: string): Promise<void>;
  recordPush(success: boolean, detail: string): Promise<void>;
}

async function kkvGet(
  kkv: KkvService,
  key: string,
): Promise<string | undefined> {
  try {
    return await kkv.get(CLOUD_SYNC_KKV_MODULE, key);
  } catch (error) {
    if (error instanceof KkvError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

function parseBool(value: string | undefined): boolean {
  return value === "true";
}

function parseRev(value: string | undefined): number {
  if (value == null || value.trim() === "") {
    return 0;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function assertNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
}

export function createCloudSyncConfigStore(
  kkv: KkvService,
  secretStore: SecretStore,
): CloudSyncConfigStore {
  async function readPublicConfig(): Promise<CloudSyncPublicConfig> {
    const [
      endpoint,
      bucket,
      region,
      pathPrefix,
      accessKeyId,
      forcePathStyle,
      deviceId,
      deviceLabel,
      lastSyncedRev,
      lastPullAt,
      lastPushAt,
      lastPullResult,
      lastPushResult,
    ] = await Promise.all([
      kkvGet(kkv, CLOUD_SYNC_KEY_ENDPOINT),
      kkvGet(kkv, CLOUD_SYNC_KEY_BUCKET),
      kkvGet(kkv, CLOUD_SYNC_KEY_REGION),
      kkvGet(kkv, CLOUD_SYNC_KEY_PATH_PREFIX),
      kkvGet(kkv, CLOUD_SYNC_KEY_ACCESS_KEY_ID),
      kkvGet(kkv, CLOUD_SYNC_KEY_FORCE_PATH_STYLE),
      kkvGet(kkv, CLOUD_SYNC_KEY_DEVICE_ID),
      kkvGet(kkv, CLOUD_SYNC_KEY_DEVICE_LABEL),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_SYNCED_REV),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PULL_AT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PUSH_AT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PULL_RESULT),
      kkvGet(kkv, CLOUD_SYNC_KEY_LAST_PUSH_RESULT),
    ]);

    return {
      endpoint: endpoint ?? "",
      bucket: bucket ?? "",
      region: region ?? "",
      pathPrefix: pathPrefix ?? "",
      accessKeyId: accessKeyId ?? "",
      forcePathStyle: parseBool(forcePathStyle),
      deviceId: deviceId ?? "",
      deviceLabel: deviceLabel ?? "",
      lastSyncedRev: parseRev(lastSyncedRev),
      lastPullAt: lastPullAt ?? "",
      lastPushAt: lastPushAt ?? "",
      lastPullResult: lastPullResult ?? "",
      lastPushResult: lastPushResult ?? "",
    };
  }

  return {
    async getConfig() {
      const publicConfig = await readPublicConfig();
      const hasSecretKey = await secretStore.has(CLOUD_SYNC_SKSP_SECRET_REF);
      return {
        endpoint: publicConfig.endpoint,
        bucket: publicConfig.bucket,
        region: publicConfig.region,
        pathPrefix: publicConfig.pathPrefix,
        accessKeyId: publicConfig.accessKeyId,
        forcePathStyle: publicConfig.forcePathStyle,
        deviceId: publicConfig.deviceId,
        deviceLabel: publicConfig.deviceLabel,
        hasSecretKey,
      };
    },

    async setConfig(input) {
      assertNonEmpty("Endpoint", input.endpoint);
      assertNonEmpty("Bucket", input.bucket);
      assertNonEmpty("Access Key", input.accessKeyId);

      const existing = await readPublicConfig();
      const hasSecret = await secretStore.has(CLOUD_SYNC_SKSP_SECRET_REF);
      const secret = input.secretAccessKey?.trim() ?? "";
      if (!hasSecret && secret.length === 0) {
        throw new Error("Secret Key 不能为空");
      }

      const deviceId =
        existing.deviceId.trim().length > 0 ? existing.deviceId : randomUUID();

      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_ENDPOINT, input.endpoint.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_BUCKET, input.bucket.trim()),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_REGION, input.region.trim()),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_PATH_PREFIX,
          input.pathPrefix.trim(),
        ),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_ACCESS_KEY_ID,
          input.accessKeyId.trim(),
        ),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_FORCE_PATH_STYLE,
          input.forcePathStyle ? "true" : "false",
        ),
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_DEVICE_ID, deviceId),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_DEVICE_LABEL,
          (input.deviceLabel ?? existing.deviceLabel).trim(),
        ),
      ]);

      if (secret.length > 0) {
        await secretStore.set(CLOUD_SYNC_SKSP_SECRET_REF, secret);
      }
    },

    async getPublicConfig() {
      return readPublicConfig();
    },

    async getSecretAccessKey() {
      return secretStore.get(CLOUD_SYNC_SKSP_SECRET_REF);
    },

    async getLocalMeta() {
      const cfg = await readPublicConfig();
      return {
        lastSyncedRev: cfg.lastSyncedRev,
        lastPullAt: cfg.lastPullAt,
        lastPushAt: cfg.lastPushAt,
        lastPullResult: cfg.lastPullResult,
        lastPushResult: cfg.lastPushResult,
      };
    },

    async setLastSyncedRev(rev) {
      await kkv.set(
        CLOUD_SYNC_KKV_MODULE,
        CLOUD_SYNC_KEY_LAST_SYNCED_REV,
        String(rev),
      );
    },

    async recordPull(success, detail) {
      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PULL_AT, new Date().toISOString()),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_LAST_PULL_RESULT,
          `${success ? "成功" : "失败"}：${detail}`,
        ),
      ]);
    },

    async recordPush(success, detail) {
      await Promise.all([
        kkv.set(CLOUD_SYNC_KKV_MODULE, CLOUD_SYNC_KEY_LAST_PUSH_AT, new Date().toISOString()),
        kkv.set(
          CLOUD_SYNC_KKV_MODULE,
          CLOUD_SYNC_KEY_LAST_PUSH_RESULT,
          `${success ? "成功" : "失败"}：${detail}`,
        ),
      ]);
    },
  };
}
