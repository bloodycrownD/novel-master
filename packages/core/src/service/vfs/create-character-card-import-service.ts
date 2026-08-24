/**
 * {@link CharacterCardImportService} 工厂。
 *
 * @module service/vfs/create-character-card-import-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { CharacterCardImportService } from "@/domain/vfs/ports/character-card-import.port.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import {
  DefaultCharacterCardImportService,
  type CharacterCardImportTestHook,
} from "./impl/character-card-import.service.js";

export type CreateCharacterCardImportServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: CharacterCardImportTestHook;
};

/**
 * 为给定连接创建角色卡导入服务。
 */
export function createCharacterCardImportService(
  conn: TdbcConnection,
  options: CreateCharacterCardImportServiceOptions = {},
): CharacterCardImportService {
  const repo = new SqliteVfsEntryRepository(conn);
  return new DefaultCharacterCardImportService(conn, repo, {
    testHook: options.testHook,
    // 对外签名 (conn, options?) 不变；sessionKkv 在工厂内部自建并注入。
    sessionKkv: createSessionKkvService(conn),
  });
}
