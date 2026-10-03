/**
 * Factory for {@link VfsBatchIoService}.
 *
 * @module service/vfs/create-vfs-batch-io-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsBatchIoService } from "@/domain/vfs/ports/vfs-batch-io.port.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import {
  DefaultVfsBatchIoService,
  type VfsBatchImportTestHook,
} from "./impl/vfs-batch-io.service.js";

export type CreateVfsBatchIoServiceOptions = {
  /** @internal 回滚单测专用 */
  readonly testHook?: VfsBatchImportTestHook;
};

/** 创建批量 ingest/export 服务。 */
export function createVfsBatchIoService(
  conn: TdbcConnection,
  options: CreateVfsBatchIoServiceOptions = {}
): VfsBatchIoService {
  const repo = new SqliteVfsEntryRepository(conn);
  return new DefaultVfsBatchIoService(conn, repo, {
    testHook: options.testHook,
    // 对外签名 (conn, options?) 不变；sessionKkv 在工厂内部自建并注入
    // （照 zip / 角色卡工厂的同一模式）。
    sessionKkv: createSessionKkvService(conn),
  });
}
