/**
 * better-sqlite3 TDBC driver registration target.
 *
 * @module tdbc-driver-better-sqlite3/driver
 */

import Database from "better-sqlite3";
import type { OpenOptions, TdbcConnection, TdbcDriver } from "@novel-master/core";
import { TdbcError } from "@novel-master/core";
import { BetterSqlite3Connection } from "./connection.js";

export const BETTER_SQLITE3_DRIVER_NAME = "better-sqlite3";

export class BetterSqlite3Driver implements TdbcDriver {
  readonly name = BETTER_SQLITE3_DRIVER_NAME;

  async open(
    options: OpenOptions & { url?: string },
  ): Promise<TdbcConnection> {
    const filename = options.filename ?? ":memory:";
    try {
      const db = new Database(filename, {
        readonly: options.readOnly ?? false,
      });
      return new BetterSqlite3Connection(db);
    } catch (cause) {
      throw new TdbcError("SQLITE_ERROR", "Failed to open database", {
        driver: this.name,
        cause,
      });
    }
  }
}
