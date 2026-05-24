import {
  bootstrapVfs,
  createVfsService,
  open,
  type TdbcConnection,
  type VfsService,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

/** Opens an in-memory VFS connection for integration tests. */
export async function openVfsTestConnection(): Promise<{
  conn: TdbcConnection;
  vfs: VfsService;
}> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  await bootstrapVfs(conn);
  const vfs = createVfsService(conn);
  return { conn, vfs };
}
