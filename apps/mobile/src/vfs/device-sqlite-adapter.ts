/**
 * Device SQLite adapter with a static native import so Metro bundles quick-sqlite.
 *
 * @remarks The workspace {@link QuickSqliteAdapter} uses dynamic import from compiled
 * dist, which Metro often fails to resolve; this file lives in the app bundle instead.
 */
import {open, QuickSQLite} from 'react-native-quick-sqlite';
import type {QuickSqliteResult, RnSqliteAdapter} from '@novel-master/tdbc-driver-rn';

export class DeviceSqliteAdapter implements RnSqliteAdapter {
  private dbName = 'default';
  private closer?: () => void;

  async open(options: {name: string; location?: string}): Promise<void> {
    this.dbName = options.name;
    const handle = open({
      name: options.name,
      location: options.location ?? 'default',
    });
    this.closer = () => handle.close();
  }

  async close(): Promise<void> {
    this.closer?.();
    this.closer = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult> {
    if (typeof QuickSQLite.executeAsync === 'function') {
      return QuickSQLite.executeAsync(this.dbName, sql, params ?? []);
    }
    return QuickSQLite.execute(this.dbName, sql, params ?? []);
  }
}
