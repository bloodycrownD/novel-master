/**
 * 云同步配置：KKV `nm-cloud-sync` 存非密钥字段，SKSP 存 Secret Access Key。
 *
 * @module services/cloud-sync-config.store
 */
import type {CloudSyncConfigInput} from '@novel-master/core';
import {Coerce, Kkv, Path} from '@novel-master/core/common';
import {Result, AppError} from '@novel-master/core/errors';
import {type SecretStore} from '@novel-master/core/sksp';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

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

/** 保存配置的输入类型统一由 core 提供（与 desktop `CloudSyncConfigInput` 单一类型）；此处转发保留既有 import 面。 */
export type {CloudSyncConfigInput} from '@novel-master/core';

/** 对外展示的配置（不含 SK 明文） */
type CloudSyncConfigPublic = {
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

type RandomCrypto = {
    randomUUID?: () => string;
    getRandomValues?: (array: Uint8Array) => Uint8Array;
};

/** 更新本机 Pull/Push 结果与时间戳。 */
type CloudSyncLocalStatusPatch = {
    lastSyncedRev?: number;
    lastPullAt?: string;
    lastPushAt?: string;
    lastPullResult?: string;
    lastPushResult?: string;
};

export namespace CloudSyncConfigStore {
    /** 生成设备 ID（首次保存配置时写入 KKV） */
    export function generateDeviceId(): string {
        const cryptoApi = (globalThis as {crypto?: RandomCrypto}).crypto;
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

    /** 读取对外配置；未配置时 endpoint 等为空串。失败沿 `Result.err` 接力。 */
    export async function get(runtime: MobileNovelMasterRuntime): Promise<Result<CloudSyncConfigPublic, AppError>> {
        const {kkv, secretStore} = runtime;
        const configKeys = [KEY_ENDPOINT, KEY_BUCKET, KEY_REGION, KEY_PATH_PREFIX, KEY_ACCESS_KEY_ID, KEY_FORCE_PATH_STYLE, KEY_DEVICE_ID, KEY_DEVICE_LABEL];
        const [endpoint, bucket, region, pathPrefix, accessKeyId, forcePathStyle, deviceId, deviceLabel] = await Promise.all(configKeys.map(key => Kkv.getOptional(kkv, CLOUD_SYNC_KKV_MODULE, key)));
        if (!endpoint.ok) return Result.err(endpoint.error);
        if (!bucket.ok) return Result.err(bucket.error);
        if (!region.ok) return Result.err(region.error);
        if (!pathPrefix.ok) return Result.err(pathPrefix.error);
        if (!accessKeyId.ok) return Result.err(accessKeyId.error);
        if (!forcePathStyle.ok) return Result.err(forcePathStyle.error);
        if (!deviceId.ok) return Result.err(deviceId.error);
        if (!deviceLabel.ok) return Result.err(deviceLabel.error);

        const secretKeySet = await secretStore.has(CLOUD_SYNC_SECRET_REF);

        return Result.ok({
            endpoint: endpoint.value ?? '',
            bucket: bucket.value ?? '',
            region: region.value ?? '',
            pathPrefix: pathPrefix.value ?? DEFAULT_CLOUD_SYNC_PATH_PREFIX,
            accessKeyId: accessKeyId.value ?? '',
            forcePathStyle: forcePathStyle.value == null || forcePathStyle.value === '' ? false : forcePathStyle.value === 'true' || forcePathStyle.value === '1',
            deviceId: deviceId.value ?? '',
            deviceLabel: deviceLabel.value?.trim() || undefined,
            secretKeySet,
        });
    }

    /** 读取本机同步状态字段。失败沿 `Result.err` 接力。 */
    export async function getLocalStatus(runtime: MobileNovelMasterRuntime): Promise<Result<CloudSyncLocalStatus, AppError>> {
        const config = await get(runtime);
        if (!config.ok) return Result.err(config.error);
        const {kkv} = runtime;
        const statusKeys = [KEY_LAST_SYNCED_REV, KEY_LAST_PULL_AT, KEY_LAST_PUSH_AT, KEY_LAST_PULL_RESULT, KEY_LAST_PUSH_RESULT];
        const [lastSyncedRev, lastPullAt, lastPushAt, lastPullResult, lastPushResult] = await Promise.all(statusKeys.map(key => Kkv.getOptional(kkv, CLOUD_SYNC_KKV_MODULE, key)));
        if (!lastSyncedRev.ok) return Result.err(lastSyncedRev.error);
        if (!lastPullAt.ok) return Result.err(lastPullAt.error);
        if (!lastPushAt.ok) return Result.err(lastPushAt.error);
        if (!lastPullResult.ok) return Result.err(lastPullResult.error);
        if (!lastPushResult.ok) return Result.err(lastPushResult.error);

        const configured = Coerce.nonEmptyText(config.value.endpoint) != null && Coerce.nonEmptyText(config.value.bucket) != null && Coerce.nonEmptyText(config.value.accessKeyId) != null && config.value.secretKeySet && Coerce.nonEmptyText(config.value.deviceId) != null;

        const rawRev = lastSyncedRev.value;
        const parsedRevNum = rawRev == null || rawRev === '' ? 0 : Number.parseInt(rawRev, 10);
        const parsedRev = Number.isFinite(parsedRevNum) && parsedRevNum >= 0 ? parsedRevNum : 0;
        return Result.ok({
            configured,
            deviceId: config.value.deviceId,
            lastSyncedRev: parsedRev,
            lastPullAt: lastPullAt.value ?? undefined,
            lastPushAt: lastPushAt.value ?? undefined,
            lastPullResult: lastPullResult.value ?? undefined,
            lastPushResult: lastPushResult.value ?? undefined,
        });
    }

    /** 保存配置：校验非空、生成 deviceId（若缺）、SK 写 SKSP。校验失败与已知失败统一沿 `Result.err` 上行；成功返回 void（与 desktop `setConfig` 返回通道一致）。 */
    export async function set(runtime: MobileNovelMasterRuntime, input: CloudSyncConfigInput): Promise<Result<void, AppError>> {
        if (!input.endpoint.trim()) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请填写 Endpoint'}));
        if (!input.bucket.trim()) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请填写 Bucket'}));
        if (!input.accessKeyId.trim()) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请填写 Access Key'}));
        const secret = input.secretAccessKey?.trim() ?? '';
        if (!secret) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '请填写 Secret Key'}));
        const {kkv, secretStore} = runtime;

        const existingDeviceId = await Kkv.getOptional(kkv, CLOUD_SYNC_KKV_MODULE, KEY_DEVICE_ID);
        if (!existingDeviceId.ok) return Result.err(existingDeviceId.error);
        let deviceId = existingDeviceId.value?.trim() ?? '';
        if (!deviceId) {
            deviceId = generateDeviceId();
        }

        const normalizedPrefix = Path.ensureTrailingSlash(input.pathPrefix.trim() || DEFAULT_CLOUD_SYNC_PATH_PREFIX);

        await Promise.all([
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_ENDPOINT, input.endpoint.trim()),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_BUCKET, input.bucket.trim()),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_REGION, input.region.trim()),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_PATH_PREFIX, normalizedPrefix),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_ACCESS_KEY_ID, input.accessKeyId.trim()),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_FORCE_PATH_STYLE, input.forcePathStyle ? 'true' : 'false'),
            kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_DEVICE_ID, deviceId),
            secretStore.set(CLOUD_SYNC_SECRET_REF, secret),
        ]);

        const label = input.deviceLabel?.trim();
        if (label) {
            await kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_DEVICE_LABEL, label);
        }

        return Result.ok(undefined);
    }

    export async function patchLocalStatus(runtime: MobileNovelMasterRuntime, patch: CloudSyncLocalStatusPatch): Promise<void> {
        const {kkv} = runtime;
        const tasks: Promise<void>[] = [];
        if (patch.lastSyncedRev != null) {
            tasks.push(kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_LAST_SYNCED_REV, String(patch.lastSyncedRev)));
        }
        if (patch.lastPullAt != null) {
            tasks.push(kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_LAST_PULL_AT, patch.lastPullAt));
        }
        if (patch.lastPushAt != null) {
            tasks.push(kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_LAST_PUSH_AT, patch.lastPushAt));
        }
        if (patch.lastPullResult != null) {
            tasks.push(kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_LAST_PULL_RESULT, patch.lastPullResult));
        }
        if (patch.lastPushResult != null) {
            tasks.push(kkv.set(CLOUD_SYNC_KKV_MODULE, KEY_LAST_PUSH_RESULT, patch.lastPushResult));
        }
        await Promise.all(tasks);
    }

    /** 读取 SK 明文（仅 service 内部组装 S3 配置时使用）。 */
    export async function readSecretKey(secretStore: SecretStore): Promise<string | null> {
        return secretStore.get(CLOUD_SYNC_SECRET_REF);
    }

    /** 由已存配置组装 S3 驱动配置；未配置完整收 `CLOUD_SYNC_NOT_CONFIGURED`（desktop 镜像同款），读失败沿 `Result.err` 上行。 */
    export async function buildS3StorageConfig(runtime: MobileNovelMasterRuntime, overrides?: Partial<CloudSyncConfigInput>): Promise<Result<S3StorageConfig, AppError>> {
        const config = await get(runtime);
        if (!config.ok) return Result.err(config.error);
        const secretKey = overrides?.secretAccessKey?.trim() || (await readSecretKey(runtime.secretStore));
        if (!config.value.endpoint.trim() || !config.value.bucket.trim() || !config.value.accessKeyId.trim() || !secretKey) {
            return Result.err(new AppError('CLOUD_SYNC_NOT_CONFIGURED', {detail: '请先完成云存储配置'}));
        }

        return Result.ok({
            endpoint: overrides?.endpoint?.trim() || config.value.endpoint.trim(),
            bucket: overrides?.bucket?.trim() || config.value.bucket.trim(),
            region: overrides?.region?.trim() ?? config.value.region.trim(),
            accessKeyId: overrides?.accessKeyId?.trim() || config.value.accessKeyId.trim(),
            secretAccessKey: secretKey,
            forcePathStyle: overrides?.forcePathStyle ?? config.value.forcePathStyle,
        });
    }
}
