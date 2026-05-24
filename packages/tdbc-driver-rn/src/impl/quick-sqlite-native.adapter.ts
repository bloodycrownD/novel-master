/**
 * Metro-safe {@link RnSqliteAdapter} with static react-native-quick-sqlite import.
 *
 * @module tdbc-driver-rn/impl/quick-sqlite-native.adapter
 */

import { open, QuickSQLite } from "react-native-quick-sqlite";
import { BaseQuickSqliteAdapter } from "./quick-sqlite.adapter.js";

/** RN / Metro entry adapter; static peer import for bundler dependency graph. */
export class NativeQuickSqliteAdapter extends BaseQuickSqliteAdapter {
  constructor() {
    super({ open, QuickSQLite });
  }
}
