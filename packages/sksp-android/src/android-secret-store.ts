/**
 * Android Keystore + SQLite `sksp_secrets` store。
 *
 * 重构后只保留平台 strategy 实现，SQL 编排交给
 * {@link BaseSqliteSecretStore}。Keystore 密文走 base64 文本存储
 * （quick-sqlite heap 损伤 workaround），所以 strategy 返回的
 * ciphertext/iv 是 string 而不是 Uint8Array。
 *
 * @module android-secret-store
 */

import { Encoding } from "@novel-master/core/common";
import type { TdbcConnection, Row } from "@novel-master/core/tdbc";
import {
    BaseSqliteSecretStore,
    SkspError,
    type SecretStore,
    type SkspCryptoStrategy,
} from "@novel-master/core/sksp";
import { SkspNative } from "./native.js";

const ALGO = "android-keystore-aes-gcm-v1";

/** Android Keystore 加密策略：密文/iv 都以 base64 文本存进 DB。 */
const androidStrategy: SkspCryptoStrategy = {
    algo: ALGO,
    async encrypt(ref, plain) {
        const native = SkspNative.get();
        try {
            const enc = await native.encrypt(ref, plain);
            // 存 base64 文本，不走 Uint8Array BLOB 绑定（quick-sqlite heap 损伤）。
            return { ciphertext: enc.ciphertext, iv: enc.iv };
        } catch (cause) {
            // nm-throw: keep — SecretStore 端口的失败通道是 Promise reject（core 契约，sksp-android.test 以 assert.rejects 锁定）：Android Keystore 原生桥只以 reject 报错，此处转 SkspError 交 BaseSqliteSecretStore.set 的调用方经 reject 接住
            throw new SkspError("ENCRYPT_FAILED", `Keystore encrypt failed for ${ref}`, { ref, cause },);
        }
    },
    async decrypt(ref, row: Row) {
        const iv = row.iv;
        if (iv == null) {
            // nm-throw: keep — SecretStore 端口的失败通道是 Promise reject（core 契约）：strategy.decrypt 无 Result 通道，DB 行缺 IV 转 SkspError 交 store.get 的调用方经 reject 接住
            throw new SkspError("DECRYPT_FAILED", `Missing IV for ${ref}`, { ref });
        }
        const native = SkspNative.get();
        try {
            return await native.decrypt(ref, Encoding.bytesToBase64(AndroidSecretStoreFactory.decodeBlob(row.ciphertext)), Encoding.bytesToBase64(AndroidSecretStoreFactory.decodeBlob(iv)),);
        } catch (cause) {
            // nm-throw: keep — SecretStore 端口的失败通道是 Promise reject（core 契约，sksp-android.test 以 assert.rejects 锁定）：Keystore 原生桥只以 reject 报错，此处转 SkspError 交 store.get 的调用方经 reject 接住
            throw new SkspError("DECRYPT_FAILED", `Keystore decrypt failed for ${ref}. Re-configure apiKey.`, { ref, cause },);
        }
    },
};

/** Android SKSP store backed by Keystore and `sksp_secrets`. */
export class AndroidSecretStore extends BaseSqliteSecretStore {
    constructor(conn: TdbcConnection) {
        super(conn, androidStrategy);
    }
}

// nm-style 注记：namespace 按内容主体起名（撞同文件 export class AndroidSecretStore，取工厂主体 AndroidSecretStoreFactory）。
/** Creates an Android secret store for an open connection. */
export namespace AndroidSecretStoreFactory {
    // nm-style 注记：本应保持 namespace 私有，但顶层 androidStrategy（const，不收口）依赖它，须以 namespace 成员形态暴露（不经 barrel，包外不可见）。
    export function decodeBlob(value: unknown): Uint8Array {
        if (value instanceof Uint8Array) {
            return value;
        }
        if (typeof value === "string") {
            return Encoding.base64ToBytes(value);
        }
        // nm-throw: keep — 驱动转码链一环：DB blob 列形态损坏（数据损坏非代码不变量）转 SkspError(DB_ERROR)，唯一调用方 androidStrategy.decrypt 在 try 内 catch 转 DECRYPT_FAILED 交 SecretStore 端口 reject 通道
        throw new SkspError("DB_ERROR", "Invalid blob column");
    }

    export function create(conn: TdbcConnection): SecretStore {
        return new AndroidSecretStore(conn);
    }
}
