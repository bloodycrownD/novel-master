/**
 * Default {@link RnSqliteAdapter} with lazy dynamic load of react-native-quick-sqlite.
 *
 * @module tdbc-driver-rn/impl/quick-sqlite-dynamic.adapter
 * @remarks Uses named exports `open` + `QuickSQLite`; execute lives on QuickSQLite only.
 */

import type { QuickSqliteResult, RnSqliteAdapter } from "../adapter.js";
import {
  BaseQuickSqliteAdapter,
  type QuickSqliteBindings,
} from "./quick-sqlite.adapter.js";

async function loadQuickSqlite(): Promise<QuickSqliteBindings> {
  try {
    const mod = (await import(
      "react-native-quick-sqlite"
    )) as Partial<QuickSqliteBindings>;
    if (typeof mod.open !== "function" || mod.QuickSQLite == null) {
      throw new Error(
        "react-native-quick-sqlite exports missing (expected open + QuickSQLite)",
      );
    }
    return mod as QuickSqliteBindings;
  } catch (cause) {
    throw new Error(
      "react-native-quick-sqlite is not installed or failed to load. Add it as a peer dependency and rebuild the native app.",
      { cause },
    );
  }
}

/**
 * Thin wrapper around react-native-quick-sqlite async execute APIs (dynamic import).
 */
export class QuickSqliteAdapter implements RnSqliteAdapter {
  private delegate?: BaseQuickSqliteAdapter;

  async open(options: { name: string; location?: string }): Promise<void> {
    const bindings = await loadQuickSqlite();
    this.delegate = new BaseQuickSqliteAdapter(bindings);
    await this.delegate.open(options);
  }

  async close(): Promise<void> {
    await this.delegate?.close();
    this.delegate = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult> {
    const delegate = this.delegate;
    if (!delegate) {
      throw new Error("Adapter not open");
    }
    return delegate.execute(sql, params);
  }
}
