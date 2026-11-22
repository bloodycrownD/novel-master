/**
 * TDBC (TypeScript Database Connectivity): async SQLite protocol, registry, and helpers.
 *
 * Zero native dependencies in this module; drivers register via {@link TdbcRegistry.register}.
 *
 * @module infra/tdbc
 */

export type { TdbcConnection } from "./ports/connection.port.js";
export type { TdbcDriver } from "./ports/driver.port.js";
export { TdbcError } from "./errors.js";
export type { TdbcErrorCode } from "./errors.js";
export { AsyncMutex } from "./logic/async-mutex.js";
export { TdbcBindings } from "./logic/normalize-bindings.js";
export { TdbcOpen } from "./logic/open.js";
export type { ParsedTdbcUrl } from "./logic/open.js";
export { TdbcRegistry } from "./logic/registry.js";
export { TdbcTemplate } from "./logic/template-helper.js";
export { TdbcTransaction } from "./logic/transaction-helper.js";
export type {
    BatchResult,
    ExecuteResult,
    OpenOptions,
    Row,
    SqlValue,
} from "./types.js";
