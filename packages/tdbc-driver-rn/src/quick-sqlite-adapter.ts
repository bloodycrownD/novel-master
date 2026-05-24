/**
 * Default {@link RnSqliteAdapter} delegating to react-native-quick-sqlite.
 *
 * @module tdbc-driver-rn/quick-sqlite-adapter
 * @remarks Uses named exports `open` + `QuickSQLite`; execute lives on QuickSQLite only.
 */

import type { QuickSqliteResult, RnSqliteAdapter } from "./adapter.js";

type QuickSqliteHandle = {
  close: () => void;
};

type QuickSqliteEngine = {
  execute: (
    dbName: string,
    sql: string,
    params?: unknown[],
  ) => QuickSqliteResult;
  executeAsync?: (
    dbName: string,
    sql: string,
    params?: unknown[],
  ) => Promise<QuickSqliteResult>;
};

type QuickSqliteModule = {
  open: (options: {
    name: string;
    location?: string;
  }) => QuickSqliteHandle;
  QuickSQLite: QuickSqliteEngine;
};

async function loadQuickSqlite(): Promise<QuickSqliteModule> {
  try {
    const mod = (await import(
      "react-native-quick-sqlite"
    )) as Partial<QuickSqliteModule>;
    if (typeof mod.open !== "function" || mod.QuickSQLite == null) {
      throw new Error(
        "react-native-quick-sqlite exports missing (expected open + QuickSQLite)",
      );
    }
    return mod as QuickSqliteModule;
  } catch (cause) {
    throw new Error(
      "react-native-quick-sqlite is not installed or failed to load. Add it as a peer dependency and rebuild the native app.",
      { cause },
    );
  }
}

/**
 * Thin wrapper around react-native-quick-sqlite async execute APIs.
 */
export class QuickSqliteAdapter implements RnSqliteAdapter {
  private engine?: QuickSqliteEngine;
  private dbName = "default";
  private closer?: () => void;

  async open(options: { name: string; location?: string }): Promise<void> {
    const { open, QuickSQLite } = await loadQuickSqlite();
    this.engine = QuickSQLite;
    this.dbName = options.name;
    const handle = open({
      name: options.name,
      // quick-sqlite expects a storage location; default = app databases dir
      location: options.location ?? "default",
    });
    this.closer = () => handle.close();
  }

  async close(): Promise<void> {
    this.closer?.();
    this.closer = undefined;
    this.engine = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult> {
    const engine = this.engine;
    if (!engine) {
      throw new Error("Adapter not open");
    }
    if (typeof engine.executeAsync === "function") {
      return engine.executeAsync(this.dbName, sql, params ?? []);
    }
    return engine.execute(this.dbName, sql, params ?? []);
  }
}
