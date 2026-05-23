/**
 * TDBC (TypeScript Database Connectivity): async SQLite protocol, registry, and helpers.
 *
 * Zero native dependencies in this module; drivers register via {@link registerDriver}.
 *
 * @module infra/tdbc
 */

export type { TdbcConnection } from "./connection.js";
export type { TdbcDriver } from "./driver.js";
export { TdbcError } from "./errors.js";
export type { TdbcErrorCode } from "./errors.js";
export { normalizeBindings } from "./normalize-bindings.js";
export { open, parseUrl } from "./open.js";
export type { ParsedTdbcUrl } from "./open.js";
export {
  clearDrivers,
  getDriver,
  listDrivers,
  registerDriver,
  resolveDriver,
} from "./registry.js";
export { executeTemplate, queryTemplate } from "./template-helper.js";
export type {
  BatchResult,
  ExecuteResult,
  OpenOptions,
  Row,
  SqlValue,
} from "./types.js";
