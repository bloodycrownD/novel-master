/**
 * AES-256-GCM 加密策略：Linux Secret Service / macOS Keychain 共用。
 *
 * 主密钥来源由平台注入（钥匙串读取），这里只负责取钥顺序与行列解码。
 *
 * @module infra/sksp/impl/aes-gcm-strategy
 */

import type { Row } from "../../tdbc/types.js";
import { AesGcm } from "../logic/aes-gcm.js";
import { SkspRowBinary } from "../logic/row-binary.js";
import type { SkspCryptoStrategy } from "./sksp-strategy.port.js";

/** 平台主密钥来源：按操作取 32 字节主密钥。 */
type MasterKeySource = (ref: string, operation: "encrypt" | "decrypt") => Promise<Uint8Array>;

interface AesGcmStrategyOptions {
  /** 对应 `sksp_secrets.algo` 列（各平台自有的版本标识）。 */
  readonly algo: string;
  readonly masterKey: MasterKeySource;
}

/** 拼装 AES-GCM 策略：取主密钥 → 加解密；ciphertext/iv 以 Uint8Array 存库。 */
export function createAesGcmStrategy({ algo, masterKey }: AesGcmStrategyOptions): SkspCryptoStrategy {
  return {
    algo,
    async encrypt(ref, plain) {
      const key = await masterKey(ref, "encrypt");
      return AesGcm.encrypt(plain, key, ref);
    },
    async decrypt(ref, row: Row) {
      const key = await masterKey(ref, "decrypt");
      return AesGcm.decrypt(SkspRowBinary.ciphertext(row), SkspRowBinary.iv(row, ref), key, ref);
    },
  };
}
