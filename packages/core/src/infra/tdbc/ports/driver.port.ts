/**
 * TDBC driver contract: named plugin that opens connections.
 *
 * @module infra/tdbc/ports/driver.port
 */

import type { TdbcConnection } from "./connection.port.js";
import type { OpenOptions } from "../types.js";

/** Pluggable backend that materializes {@link TdbcConnection} instances. */
export interface TdbcDriver {
  readonly name: string;
  open(options: OpenOptions & { url?: string }): Promise<TdbcConnection>;
}
