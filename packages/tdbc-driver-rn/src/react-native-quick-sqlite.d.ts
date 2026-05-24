declare module "react-native-quick-sqlite" {
  export function open(options: {
    name: string;
    location?: string;
  }): { close: () => void };

  export const QuickSQLite: {
    execute: (
      dbName: string,
      sql: string,
      params?: unknown[],
    ) => {
      rows?: Record<string, unknown>[];
      rowsAffected?: number;
      insertId?: number;
    };
    executeAsync?: (
      dbName: string,
      sql: string,
      params?: unknown[],
    ) => Promise<{
      rows?: Record<string, unknown>[];
      rowsAffected?: number;
      insertId?: number;
    }>;
  };

  export function execute(
    dbName: string,
    sql: string,
    params?: unknown[],
  ): {
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
    insertId?: number;
  };

  export function executeAsync(
    dbName: string,
    sql: string,
    params?: unknown[],
  ): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
    insertId?: number;
  }>;
}
