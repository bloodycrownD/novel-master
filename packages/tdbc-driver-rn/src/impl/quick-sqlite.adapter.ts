/**
 * Shared quick-sqlite adapter core (bindings injected; no peer import).
 *
 * @module tdbc-driver-rn/impl/quick-sqlite.adapter
 */

import type { QuickSqliteResult, RnSqliteAdapter } from "../adapter.js";

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

/** Constructor-injected quick-sqlite module surface (not a port). */
export type QuickSqliteBindings = {
  open: (options: {
    name: string;
    location?: string;
  }) => QuickSqliteHandle;
  QuickSQLite: QuickSqliteEngine;
};

/**
 * Core {@link RnSqliteAdapter} implementation using injected quick-sqlite bindings.
 */
export class BaseQuickSqliteAdapter implements RnSqliteAdapter {
  private readonly bindings: QuickSqliteBindings;
  private dbName = "default";
  private closer?: () => void;

  constructor(bindings: QuickSqliteBindings) {
    this.bindings = bindings;
  }

  async open(options: { name: string; location?: string }): Promise<void> {
    this.dbName = options.name;
    const handle = this.bindings.open({
      name: options.name,
      // quick-sqlite expects a storage location; default = app databases dir
      location: options.location ?? "default",
    });
    this.closer = () => handle.close();
  }

  async close(): Promise<void> {
    this.closer?.();
    this.closer = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult> {
    const engine = this.bindings.QuickSQLite;
    if (typeof engine.executeAsync === "function") {
      return engine.executeAsync(this.dbName, sql, params ?? []);
    }
    return engine.execute(this.dbName, sql, params ?? []);
  }
}
