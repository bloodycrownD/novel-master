/**
 * TDBC (TypeScript Database Connectivity): async SQLite protocol, registry, and helpers.
 *
 * Zero native dependencies in this module; drivers register via {@link registerDriver}.
 *
 * @module infra/tdbc
 */

export type { TdbcConnection } from "./ports/connection.port.js";
export type { TdbcDriver } from "./ports/driver.port.js";
export { TdbcError } from "./errors.js";
export type { TdbcErrorCode } from "./errors.js";
export { normalizeBindings } from "./logic/normalize-bindings.js";
export { open, parseUrl } from "./logic/open.js";
export type { ParsedTdbcUrl } from "./logic/open.js";
export {
  clearDrivers,
  getDriver,
  listDrivers,
  registerDriver,
  resolveDriver,
} from "./logic/registry.js";
export { executeTemplate, queryTemplate } from "./logic/template-helper.js";
export type {
  BatchResult,
  ExecuteResult,
  OpenOptions,
  Row,
  SqlValue,
} from "./types.js";
