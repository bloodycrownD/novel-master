/**
 * VFS 装配工厂：service/vfs 六个 create* 工厂函数的 namespace 收口。
 *
 * @module service/vfs/vfs-service-factory
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsBatchIoService } from "@/domain/vfs/ports/vfs-batch-io.port.js";
import type { VfsZipIoService } from "@/domain/vfs/ports/vfs-zip-io.port.js";
import type { CharacterCardImportService } from "@/domain/vfs/ports/character-card-import.port.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import { DefaultVfsService } from "./impl/vfs.service.js";
import { RevisionAwareVfsService } from "./impl/revision-aware-vfs.service.js";
import { ScopedVfsService } from "./impl/scoped-vfs.service.js";
import { DefaultPhysicalVfsService } from "./impl/physical-vfs.service.js";
import { DefaultVfsBatchIoService, type VfsBatchImportTestHook } from "./impl/vfs-batch-io.service.js";
import { DefaultVfsZipIoService, type VfsZipImportTestHook } from "./impl/vfs-zip-io.service.js";
import { DefaultCharacterCardImportService, type CharacterCardImportTestHook } from "./impl/character-card-import.service.js";
import type { InternalVfsService } from "./internal-vfs.port.js";
import type { VfsService } from "./vfs.port.js";
import type { PhysicalVfsService } from "./physical-vfs.port.js";

type CreateVfsBatchIoServiceOptions = {
  /** @internal 回滚单测专用 */
  readonly testHook?: VfsBatchImportTestHook;
};

type CreateVfsZipIoServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: VfsZipImportTestHook;
};

export type CreateCharacterCardImportServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: CharacterCardImportTestHook;
};

export const VfsServiceFactory = {
  /**
   * Creates a revision-aware {@link InternalVfsService} backed by SQLite storage.
   *
   * 返回 core-internal 的 InternalVfsService（按 scopeKey + 逻辑 path 操作）；apps 入口
   * 应改用 {@link VfsServiceFactory.createScoped}，它会把 scope 隐藏在 ScopedVfsService 后面。
   *
   * @param conn - Open TDBC connection after {@link NovelMasterBootstrap.bootstrap}
   */
  create: (conn: TdbcConnection): InternalVfsService => {
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const inner = new DefaultVfsService(entryRepo);
    return new RevisionAwareVfsService(conn, inner);
  },

  /**
   * Creates a {@link VfsService} scoped to global, project, or session domain.
   *
   * @param conn - Open connection after {@link NovelMasterBootstrap.bootstrap}
   * @param scope - Visibility scope (logical paths only)
   */
  createScoped: (conn: TdbcConnection, scope: VfsScope): VfsService => {
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const inner = new RevisionAwareVfsService(conn, new DefaultVfsService(entryRepo));
    return new ScopedVfsService(inner, scope);
  },

  /**
   * Creates a read-only {@link PhysicalVfsService} for the given connection.
   *
   * @param conn - Open connection after `NovelMasterBootstrap.bootstrap`
   */
  // nm-style: keep-local — 公共组合根（cli / desktop / mobile 三端从 public/vfs 取用）：
  // 隔离 impl/DefaultPhysicalVfsService，port 层不暴露实现。
  createPhysical: (conn: TdbcConnection): PhysicalVfsService => {
    return new DefaultPhysicalVfsService(conn);
  },

  /** 创建批量 ingest/export 服务。 */
  createBatchIo: (conn: TdbcConnection, options: CreateVfsBatchIoServiceOptions = {}): VfsBatchIoService => {
    const repo = new SqliteVfsEntryRepository(conn);
    return new DefaultVfsBatchIoService(conn, repo, {
      testHook: options.testHook,
      // 对外签名 (conn, options?) 不变；sessionKkv 在工厂内部自建并注入
      // （照 zip / 角色卡工厂的同一模式）。
      sessionKkv: SessionKkvServiceFactory.create(conn),
    });
  },

  /**
   * Creates a ZIP import/export service for the given connection.
   */
  createZipIo: (conn: TdbcConnection, options: CreateVfsZipIoServiceOptions = {}): VfsZipIoService => {
    const repo = new SqliteVfsEntryRepository(conn);
    return new DefaultVfsZipIoService(conn, repo, {
      testHook: options.testHook,
      // 对外签名 (conn, options?) 不变；sessionKkv 在工厂内部自建并注入。
      sessionKkv: SessionKkvServiceFactory.create(conn),
    });
  },

  /**
   * 为给定连接创建角色卡导入服务。
   */
  createCharacterCardImport: (conn: TdbcConnection, options: CreateCharacterCardImportServiceOptions = {}): CharacterCardImportService => {
    const repo = new SqliteVfsEntryRepository(conn);
    return new DefaultCharacterCardImportService(conn, repo, {
      testHook: options.testHook,
      // 对外签名 (conn, options?) 不变；sessionKkv 在工厂内部自建并注入。
      sessionKkv: SessionKkvServiceFactory.create(conn),
    });
  },
} as const;
