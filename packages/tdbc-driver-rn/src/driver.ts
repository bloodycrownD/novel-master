/**
 * React Native TDBC driver (quick-sqlite or injected adapter).
 *
 * @module tdbc-driver-rn/driver
 */

import type { OpenOptions, TdbcConnection, TdbcDriver } from "@novel-master/core";
import { TdbcError } from "@novel-master/core";
import type { RnSqliteAdapter } from "./adapter.js";
import { RnConnection } from "./connection.js";

export const RN_DRIVER_NAME = "rn";

/** RN-specific open options (adapter injection for tests). */
export interface RnOpenOptions extends OpenOptions {
  adapter?: RnSqliteAdapter;
  /** Database name passed to quick-sqlite `open`. */
  dbName?: string;
  location?: string;
}

export class RnDriver implements TdbcDriver {
  readonly name = RN_DRIVER_NAME;
  private readonly defaultAdapter: RnSqliteAdapter;

  /**
   * @param defaultAdapter - Required; entry modules ({@link index.ts}, {@link native.ts}) supply impl.
   */
  constructor(defaultAdapter: RnSqliteAdapter) {
    this.defaultAdapter = defaultAdapter;
  }

  async open(options: RnOpenOptions & { url?: string }): Promise<TdbcConnection> {
    const adapter = options.adapter ?? this.defaultAdapter;
    const name = options.dbName ?? options.filename ?? "default";

    try {
      await adapter.open({
        name,
        location: options.location,
      });
      // 显式开启 foreign_keys：OP-SQLite / quick-sqlite 默认 off，
      // 不开的话 mobile 端 ON DELETE CASCADE 形同虚设。PRAGMA 不能
      // 在事务内执行，所以放在连接刚建立、任何事务之前的这个位置。
      await adapter.execute("PRAGMA foreign_keys = ON");
      return new RnConnection(adapter);
    } catch (cause) {
      throw new TdbcError("SQLITE_ERROR", "Failed to open database", {
        driver: this.name,
        cause,
      });
    }
  }
}
