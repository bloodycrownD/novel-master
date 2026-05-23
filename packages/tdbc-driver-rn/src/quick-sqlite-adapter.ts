/**
 * Default {@link RnSqliteAdapter} delegating to react-native-quick-sqlite.
 *
 * @module tdbc-driver-rn/quick-sqlite-adapter
 */

import type { QuickSqliteResult, RnSqliteAdapter } from "./adapter.js";

type QuickSqliteModule = {
  open: (options: {
    name: string;
    location?: string;
  }) => { close: () => void };
  execute: (
    dbName: string,
    sql: string,
    params?: unknown[],
  ) => QuickSqliteResult;
  executeAsync: (
    dbName: string,
    sql: string,
    params?: unknown[],
  ) => Promise<QuickSqliteResult>;
};

async function loadQuickSqlite(): Promise<QuickSqliteModule> {
  try {
    return (await import(
      "react-native-quick-sqlite"
    )) as QuickSqliteModule;
  } catch (cause) {
    throw new Error(
      "react-native-quick-sqlite is not installed. Add it as a peer dependency.",
      { cause },
    );
  }
}

/**
 * Thin wrapper around react-native-quick-sqlite async execute APIs.
 */
export class QuickSqliteAdapter implements RnSqliteAdapter {
  private quick?: QuickSqliteModule;
  private dbName = "default";
  private closer?: () => void;

  async open(options: { name: string; location?: string }): Promise<void> {
    this.quick = await loadQuickSqlite();
    this.dbName = options.name;
    const handle = this.quick.open({
      name: options.name,
      location: options.location,
    });
    this.closer = () => handle.close();
  }

  async close(): Promise<void> {
    this.closer?.();
    this.closer = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult> {
    const quick = this.quick;
    if (!quick) {
      throw new Error("Adapter not open");
    }
    if (quick.executeAsync) {
      return quick.executeAsync(this.dbName, sql, params ?? []);
    }
    return quick.execute(this.dbName, sql, params ?? []);
  }
}
