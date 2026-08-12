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
      // 显式开启 foreign_keys，和 RN 驱动保持对称。better-sqlite3 默认
      // 已经是 ON，这里再设一次幂等无害，但写出来后两端语义一致，
      // 也防住日后有人改默认值或换构建配置。
      db.pragma("foreign_keys = ON");
      return new BetterSqlite3Connection(db);
    } catch (cause) {
      throw new TdbcError("SQLITE_ERROR", "Failed to open database", {
        driver: this.name,
        cause,
      });
    }
  }
}
