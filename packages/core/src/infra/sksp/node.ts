/**
 * SKSP Node 端共享实现：AES-GCM、钥匙串主密钥、`sksp_secrets` 行列解码。
 *
 * 只对 Node 平台包（sksp-linux / sksp-mac / sksp-windows）开放。**禁止**从
 * `./index.js`（`@novel-master/core/sksp`）再导出——这里引用了 `node:crypto`
 * 与 Node 全局 `Buffer`，进了 React Native bundle 会解析失败：mobile 的 Metro
 * 只给 stream / buffer / fs 配了垫片（见 apps/mobile/metro.config.js 的
 * nodeBuiltinAliases），而 core 的既有约定是 RN 图里不引用 node:crypto。
 *
 * @module infra/sksp/node
 */

export { AesGcm } from "./logic/aes-gcm.js";
export { SkspRowBinary } from "./logic/row-binary.js";
export { createAesGcmStrategy } from "./impl/aes-gcm-strategy.js";
export { createKeyringMasterKey } from "./impl/keyring-master-key.js";
