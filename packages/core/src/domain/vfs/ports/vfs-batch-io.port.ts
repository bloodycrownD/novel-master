/**
 * VFS 批量导入/导出规划与落库合同。
 *
 * @module domain/vfs/ports/vfs-batch-io.port
 */

import type { VfsScope } from "../logic/vfs-path-mapper.js";

/** 宿主传入的原始 ingest 条目（文件字节或显式空目录）。 */
export type BatchIngestRawEntry =
  | {
      readonly relativePath: string;
      readonly kind: "file";
      readonly bytes: Uint8Array;
    }
  | {
      readonly relativePath: string;
      readonly kind: "directory";
    };

/** plan 通过 UTF-8 校验后的可写文件。 */
export interface BatchIngestPlanEntry {
  readonly relativePath: string;
  /** 已通过 UTF-8 校验的文本内容 */
  readonly content: string;
}

/** 目标处已存在的冲突（默认覆盖前需确认）。 */
export interface BatchConflict {
  readonly logicalPath: string;
  readonly reason: "exists";
}

/**
 * apply 完成后的汇总。
 * 路径均为域内逻辑 path（以 `/` 为根）。
 */
export interface BatchApplyReport {
  /** 已成功写入的文件逻辑路径（默认不含 mkdir 目录节点） */
  readonly written: string[];
  /** 预检或策略性未写：非法 UTF-8、用户跳过冲突等；非异常 */
  readonly skipped: string[];
  /** 执行期异常未写成功的项 */
  readonly failed: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

/** plan 阶段检测到的 file/directory 类型冲突。 */
export interface BatchIngestTypeConflict {
  readonly logicalPath: string;
  readonly message: string;
}

/** planBatchIngest 结果。 */
export interface BatchIngestPlan {
  readonly writes: readonly BatchIngestPlanEntry[];
  /** 需显式 mkdir 的空目录逻辑路径（已含 targetDir 前缀） */
  readonly mkdirPaths: readonly string[];
  readonly conflicts: readonly BatchConflict[];
  /** 非法 UTF-8；相对路径形式，与输入 relativePath 对齐 */
  readonly skippedBinary: readonly string[];
  /** 同批次内 file/dir 互斥路径冲突；apply 前须处理，不得静默写入 */
  readonly typeConflicts: readonly BatchIngestTypeConflict[];
}

/** 导出规划中的单个文件。 */
export interface BatchExportFileEntry {
  /** 相对导出根的路径（无 leading `/`） */
  readonly relativePath: string;
  readonly content: string;
}

/** planBatchExport 结果。 */
export interface BatchExportPlan {
  readonly files: readonly BatchExportFileEntry[];
  /** 相对导出根的空目录（无 leading `/`，无 trailing `/`） */
  readonly mkdirPaths: readonly string[];
}

export interface BatchApplyOptions {
  /** 有冲突时须为 true，否则整批不写 */
  readonly overwriteConfirmed: boolean;
}

/**
 * 逐文件写入执行器（session + user-vfs-turn 通道）。
 * 每成功一项即落库/进 pending；失败不整批回滚。
 */
export interface BatchIngestWriter {
  mkdir(logicalPath: string): Promise<void>;
  writeFile(logicalPath: string, content: string): Promise<void>;
}

/**
 * 批量 ingest / export 规划与非 session 事务落库。
 */
export interface VfsBatchIoService {
  planBatchIngest(
    scope: VfsScope,
    targetDir: string,
    entries: readonly BatchIngestRawEntry[],
  ): Promise<BatchIngestPlan>;

  /**
   * 非 session 通道：单事务整批 apply；任一项失败 → 整批回滚。
   */
  applyBatchIngest(
    scope: VfsScope,
    targetDir: string,
    plan: BatchIngestPlan,
    options: BatchApplyOptions,
  ): Promise<BatchApplyReport>;

  /**
   * session 通道：按 writer 逐文件执行；部分失败保留已成功项并汇总 Report。
   */
  applyBatchIngestWithWriter(
    targetDir: string,
    plan: BatchIngestPlan,
    options: BatchApplyOptions,
    writer: BatchIngestWriter,
  ): Promise<BatchApplyReport>;

  planBatchExport(
    scope: VfsScope,
    logicalPaths: readonly string[],
  ): Promise<BatchExportPlan>;
}
