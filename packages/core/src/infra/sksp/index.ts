/**
 * SKSP（Secret Key Storage Protocol）：异步密钥存储端口、驱动注册与组合实现。
 *
 * **读取优先级：** env 命中 > DB > null（env 未设置、空字符串或仅空白视为未命中）。
 * **写入不对称：** `set`/`delete` 仅作用于 DB；env 为只读覆盖层。
 * **开发陷阱：** 在 DB 中保存 apiKey 后，shell 环境变量仍可覆盖实际请求所用密钥。
 * **Mobile：** 生产运行时 composite 不传 env store。
 * **env 命名：** `NOVEL_MASTER_PROVIDER_<ID>_API_KEY`（见 {@link refToEnvVar}）。
 * **备份：** `sksp_secrets` 含平台绑定密文；跨用户/设备恢复可能 DECRYPT_FAILED；
 *   完整备份导出可能含密文（产品层策略见 db-backup 迭代）。
 *
 * 零 native 依赖；平台驱动通过 {@link registerSkspDriver} 注册。
 * {@link EnvSecretStore} 供 CI/脚本使用（无 native）。
 *
 * CLI/Desktop 可选 `NM_SKSP_DISABLE_ENV=1` 关闭 env 层以降低信任面。
 *
 * @module infra/sksp
 */

export type { SecretStore } from "./ports/secret-store.port.js";
export { SkspError, assertValidRef } from "./sksp-error.js";
export type { SkspErrorCode } from "./sksp-error.js";
export {
  registerSkspDriver,
  getSkspDriver,
  resolveSkspDriver,
  clearSkspDrivers,
} from "./logic/registry.js";
export type { SkspDriver } from "./logic/registry.js";
export {
  createCompositeSecretStore,
} from "./impl/composite-secret-store.js";
export type { EnvSecretStoreLike } from "./impl/composite-secret-store.js";
export { refToEnvVar } from "./logic/ref-to-env.js";
export { EnvSecretStore, createEnvSecretStore } from "./impl/env-secret-store.js";
