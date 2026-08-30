/**
 * SKSP 加密策略端口：把 SQLite 编排与平台加密实现解耦。
 *
 * 三端密文载荷的运行时形态不一样，所以这里统一用 `unknown`——
 * Android 是 base64 文本（quick-sqlite heap 损伤 workaround），
 * macOS 是 Uint8Array，Windows 是 `{ ciphertext: Uint8Array, iv: null }`。
 * 序列化/反序列化的活儿都交给具体 strategy，base class 不碰。
 *
 * @module infra/sksp/impl/sksp-strategy.port
 */

import type { Row } from "../../tdbc/types.js";

/**
 * 平台加密策略接口。`algo` 用于和 DB 里的 `sksp_secrets.algo` 列做版本校验；
 * `encrypt`/`decrypt` 把密文与 iv 的具体形态留给子类自行决定。
 */
export interface SkspCryptoStrategy {
  /** 对应 `sksp_secrets.algo` 列，base class 拿来比对存储行。 */
  readonly algo: string;
  /**
   * 加密明文。返回的 `ciphertext`/`iv` 会被原样绑进 INSERT 模板，
   * 因此 iv 允许为 `null`（Windows DPAPI 没有 iv 概念）。
   */
  encrypt(
    ref: string,
    plain: string
  ): Promise<{ ciphertext: unknown; iv: unknown }>;
  /**
   * 解密 `sksp_secrets` 单行。row 的 ciphertext/iv 列类型解码、
   * null 校验都由 strategy 自己负责——base class 不替它兜底，
   * 因为 Windows 根本不读 iv，没法在 base 里统一检查。
   */
  decrypt(ref: string, row: Row): Promise<string>;
}
