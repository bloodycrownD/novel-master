/**
 * VFS 批量导入/导出规划与落库合同。
 *
 * @module domain/vfs/ports/vfs-batch-io.port
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import type { VfsScope } from "../logic/vfs-path-mapper.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

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
    /** 执行期异常未写成功的项（message 为失败原因文本或 descriptor，如 batch_ingest_partial） */
    readonly failed: ReadonlyArray<{
        readonly path: string;
        readonly message: string | CoreMessageDescriptor;
    }>;
}

/** plan 阶段检测到的 file/directory 类型冲突。 */
interface BatchIngestTypeConflict {
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
interface BatchExportFileEntry {
    /** 相对导出根的路径（无 leading `/`） */
    readonly relativePath: string;
    readonly content: string;
}

/** planBatchExport 的一条跳过记录（不丢数据、只报告）。 */
export interface BatchExportSkip {
    /** 被跳过的逻辑路径（含 leading `/`） */
    readonly logicalPath: string;
    /** 跳过原因（当前仅 `DUPLICATE_RELATIVE_PATH`） */
    readonly reason: "DUPLICATE_RELATIVE_PATH" | string;
}

/** planBatchExport 结果。 */
export interface BatchExportPlan {
    readonly files: readonly BatchExportFileEntry[];
    /** 相对导出根的空目录（无 leading `/`，无 trailing `/`） */
    readonly mkdirPaths: readonly string[];
    /**
   * 被去重跳过、**没有进 `files`** 的选中项。
   *
   * ⚠️ **可选字段**：`BatchExportPlan` 经 `public/vfs.ts` 对外导出，加必填字段会让
   * 任何手写对象字面量（含 apps 侧测试夹具）报 TS2741。
   * ⚠️ 这**不是死字段**：锚点改父目录只消掉了「纯多选文件」这一类碰撞，
   * 文件与目录同选时的相对路径碰撞依然存在，必须有地方把它报出来——
   * 否则 ZIP 里会静默少文件而 UI 零提示。
   */
    readonly skipped?: readonly BatchExportSkip[];
}

export interface BatchApplyOptions {
    /** 有冲突时须为 true，否则整批不写 */
    readonly overwriteConfirmed: boolean;
}

/** session 通道批量 apply 参数对象（>4 参收口，{@link VfsBatchIoService.applyBatchIngestWithWriter}）。 */
export type BatchApplyWithWriterParams = {
    /**
   * ⚠️ 必传：只有它能判出 session 作用域，导入成功后要清空该 session 的
   * 提示词缓存（`rule_snapshot` + `file_cache`）。
   */
    readonly scope: VfsScope;
    readonly targetDir: string;
    readonly plan: BatchIngestPlan;
    readonly options: BatchApplyOptions;
    readonly writer: BatchIngestWriter;
};

/**
 * 逐文件写入执行器（session + user-vfs-turn 通道）。
 * 每成功一项即落库/进 pending；失败不整批回滚。
 * 错误通道迁移七期：已知失败沿 `Result.err` 回传，由 applyBatchIngestWithWriter
 * 聚合进 Report.failed（Result 契约之外的未知异常仍按 catch 落表）。
 */
export interface BatchIngestWriter {
    mkdir(logicalPath: string): Promise<Result<void, AppError>>;
    writeFile(logicalPath: string, content: string): Promise<Result<void, AppError>>;
}

/**
 * 批量 ingest / export 规划与非 session 事务落库。
 * 错误通道迁移四期：路径解析 / scope 校验失败走返回值 `Result.err`；
 * 分片写入的事务内失败仍靠抛错回滚，经 Report.failed 汇总（不整批 err）。
 */
export interface VfsBatchIoService {
    planBatchIngest(
        scope: VfsScope,
        targetDir: string,
        entries: readonly BatchIngestRawEntry[]
    ): Promise<Result<BatchIngestPlan, AppError>>;

    /**
   * 非 session 通道：单事务整批 apply；任一项失败 → 整批回滚。
   */
    applyBatchIngest(
        scope: VfsScope,
        targetDir: string,
        plan: BatchIngestPlan,
        options: BatchApplyOptions
    ): Promise<Result<BatchApplyReport, AppError>>;

    /**
   * session 通道：按 writer 逐文件执行；部分失败保留已成功项并汇总 Report。
   */
    applyBatchIngestWithWriter(p: BatchApplyWithWriterParams): Promise<Result<BatchApplyReport, AppError>>;

    planBatchExport(
        scope: VfsScope,
        logicalPaths: readonly string[]
    ): Promise<Result<BatchExportPlan, AppError>>;
}
