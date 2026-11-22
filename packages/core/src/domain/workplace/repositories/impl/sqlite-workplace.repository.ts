/**
 * SQLite workplace repository.
 *
 * @module domain/workplace/repositories/impl/sqlite-workplace.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { ScopePrefix } from "@/domain/vfs/repositories/impl/scope-prefix-helpers.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { FillPolicy, InclusionMode, SortField, SortOrder, WorkplaceDirRule, WorkplaceFileRule } from "../../model/workplace-types.js";
import type { WorkplaceRepository } from "../workplace.port.js";
import { WorkplaceDirRuleSql } from "@/infra/sql-template/generated/workplace_dir_rule.mapper.generated.js";
import { WorkplaceFileRuleSql } from "@/infra/sql-template/generated/workplace_file_rule.mapper.generated.js";

function rowToDirRule(row: Row): WorkplaceDirRule {
    return {
        scopeKey: String(row.scope_key),
        logicalPath: String(row.logical_path),
        ruleEnabled: Number(row.rule_enabled) !== 0,
        sortField: String(row.sort_field) as SortField,
        sortOrder: String(row.sort_order) as SortOrder,
        headCount: Number(row.head_count),
        tailCount: Number(row.tail_count),
        fillPolicy: String(row.fill_policy) as FillPolicy,
    };
}

function rowToFileRule(row: Row): WorkplaceFileRule {
    return {
        scopeKey: String(row.scope_key),
        logicalPath: String(row.logical_path),
        inclusionMode: String(row.inclusion_mode) as InclusionMode,
    };
}

/**
 * TDBC-backed workplace configuration repository.
 */
export class SqliteWorkplaceRepository implements WorkplaceRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    /**
   * 解包接力（错误通道迁移四期门⑦）：PathNormalizer.normalize 失败沿返回值通道原样上交（本仓储各方法同款），决定权逐层交给调用方。
   */
    async upsertDirRule(rule: WorkplaceDirRule): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(rule.logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const logicalPath = resolved.value;
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceDirRuleSql.upsertDirRule, {
            scopeKey: rule.scopeKey,
            logicalPath,
            ruleEnabled: rule.ruleEnabled ? 1 : 0,
            sortField: rule.sortField,
            sortOrder: rule.sortOrder,
            headCount: rule.headCount,
            tailCount: rule.tailCount,
            fillPolicy: rule.fillPolicy,
        });
        return Result.ok(undefined);
    }

    /** nm-style: keep-public — 实现 WorkplaceRepository.upsertFileRule 端口方法；内联会把 upsert SQL 搬进调用层。 */
    async upsertFileRule(rule: WorkplaceFileRule): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(rule.logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const logicalPath = resolved.value;
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceFileRuleSql.upsertFileRule, {
            scopeKey: rule.scopeKey,
            logicalPath,
            inclusionMode: rule.inclusionMode,
        });
        return Result.ok(undefined);
    }

    /** nm-style: keep-public — 实现 WorkplaceRepository.batchUpsertDirRules 端口方法；内联会把批量 upsert SQL 搬进调用层。 */
    async batchUpsertDirRules(rules: readonly WorkplaceDirRule[]): Promise<Result<void, AppError>> {
        // 空数组直接返回：copyScope 在源 scope 无目录规则时不用特殊判断，
        // 也避免驱动对空 parametersList 的行为分歧。
        if (rules.length === 0) {
            return Result.ok(undefined);
        }
        // 位置占位符 SQL（和本 worktree 其它 batch 实现一致），一次 conn.batch 提交全部行。
        // 调用方负责先清空目标 scope，这里走 INSERT … ON CONFLICT DO UPDATE（upsert 语义）。
        // 注意：列清单与单条 upsertDirRule 共用 mapper 的 insertColumns 片段，ON CONFLICT 子句两处同步。
        const paramsList: unknown[][] = [];
        for (const rule of rules) {
            const resolved = PathNormalizer.normalize(rule.logicalPath);
            if (!resolved.ok) return Result.err(resolved.error);
            paramsList.push([rule.scopeKey, resolved.value, rule.ruleEnabled ? 1 : 0, rule.sortField, rule.sortOrder, rule.headCount, rule.tailCount, rule.fillPolicy]);
        }
        await this.conn.batch(WorkplaceDirRuleSql.batchUpsertDirRules, paramsList);
        return Result.ok(undefined);
    }

    /** nm-style: keep-public — 实现 WorkplaceRepository.batchUpsertFileRules 端口方法；内联会把批量 upsert SQL 搬进调用层。 */
    async batchUpsertFileRules(rules: readonly WorkplaceFileRule[]): Promise<Result<void, AppError>> {
        if (rules.length === 0) {
            return Result.ok(undefined);
        }
        // SQL 与单条 upsertFileRule 共用 mapper 的 insertColumns 片段。
        const paramsList: unknown[][] = [];
        for (const rule of rules) {
            const resolved = PathNormalizer.normalize(rule.logicalPath);
            if (!resolved.ok) return Result.err(resolved.error);
            paramsList.push([rule.scopeKey, resolved.value, rule.inclusionMode]);
        }
        await this.conn.batch(WorkplaceFileRuleSql.batchUpsertFileRules, paramsList);
        return Result.ok(undefined);
    }

    /** nm-style: keep-public — 实现 WorkplaceRepository.deleteScope 端口方法；内联会把双表删除 SQL 搬进调用层。 */
    async deleteScope(scopeKey: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceDirRuleSql.deleteScope, { scopeKey });
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceFileRuleSql.deleteScope, { scopeKey });
    }

    async listDirRules(scopeKey: string): Promise<WorkplaceDirRule[]> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, WorkplaceDirRuleSql.listDirRules, { scopeKey });
        return rows.map(rowToDirRule);
    }

    async listFileRules(scopeKey: string): Promise<WorkplaceFileRule[]> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, WorkplaceFileRuleSql.listFileRules, { scopeKey });
        return rows.map(rowToFileRule);
    }

    async findDirRule(scopeKey: string, logicalPath: string): Promise<Result<WorkplaceDirRule | null, AppError>> {
        const resolved = PathNormalizer.normalize(logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const rows = await TdbcTemplate.query(this.conn, this.parser, WorkplaceDirRuleSql.findDirRule, { scopeKey, logicalPath: resolved.value });
        if (rows.length === 0) {
            return Result.ok(null);
        }
        return Result.ok(rowToDirRule(rows[0]!));
    }

    /** nm-style: keep-public — 实现 WorkplaceRepository.findFileRule 端口方法；生产零调用，但端口契约仍在且端口文件不在本轮范围，测试经端口直接覆盖。 */
    async findFileRule(scopeKey: string, logicalPath: string): Promise<Result<WorkplaceFileRule | null, AppError>> {
        const resolved = PathNormalizer.normalize(logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const rows = await TdbcTemplate.query(this.conn, this.parser, WorkplaceFileRuleSql.findFileRule, { scopeKey, logicalPath: resolved.value });
        if (rows.length === 0) {
            return Result.ok(null);
        }
        return Result.ok(rowToFileRule(rows[0]!));
    }

    async copyScope(fromScopeKey: string, toScopeKey: string, mapLogicalPath: (logical: string) => Result<string, AppError>): Promise<Result<void, AppError>> {
        // 先清空目标 scope（覆盖目标 scope 原有、但不在源 scope 的规则），语义保持不变。
        await this.deleteScope(toScopeKey);
        const dirs = await this.listDirRules(fromScopeKey);
        const files = await this.listFileRules(fromScopeKey);
        // 收集两组规则后各调一次 batch，把原来「规则数 × 1」条 INSERT 压成每表 1 条 batch INSERT。
        // 映射回调走 Result 通道：任一路径映射失败即整体短路，决定权交给调用方。
        const mappedDirs: WorkplaceDirRule[] = [];
        for (const d of dirs) {
            const mapped = mapLogicalPath(d.logicalPath);
            if (!mapped.ok) return Result.err(mapped.error);
            mappedDirs.push({ ...d, scopeKey: toScopeKey, logicalPath: mapped.value });
        }
        const mappedFiles: WorkplaceFileRule[] = [];
        for (const f of files) {
            const mapped = mapLogicalPath(f.logicalPath);
            if (!mapped.ok) return Result.err(mapped.error);
            mappedFiles.push({ ...f, scopeKey: toScopeKey, logicalPath: mapped.value });
        }
        const dirUpsert = await this.batchUpsertDirRules(mappedDirs);
        if (!dirUpsert.ok) return Result.err(dirUpsert.error);
        return this.batchUpsertFileRules(mappedFiles);
    }

    async deleteRulesUnderLogicalPrefix(scopeKey: string, logicalPrefix: string): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(logicalPrefix);
        if (!resolved.ok) return Result.err(resolved.error);
        const base = resolved.value;
        const escaped = ScopePrefix.escapeLike(base);
        const childPattern = `${escaped}/%`;
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceDirRuleSql.deleteRulesUnderLogicalPrefix, { scopeKey, path: base, childPattern });
        await TdbcTemplate.execute(this.conn, this.parser, WorkplaceFileRuleSql.deleteRulesUnderLogicalPrefix, { scopeKey, path: base, childPattern });
        return Result.ok(undefined);
    }

    async renameRulesUnderLogicalPrefix(scopeKey: string, oldPrefix: string, newPrefix: string): Promise<Result<void, AppError>> {
        const oldResolved = PathNormalizer.normalize(oldPrefix);
        if (!oldResolved.ok) return Result.err(oldResolved.error);
        const newResolved = PathNormalizer.normalize(newPrefix);
        if (!newResolved.ok) return Result.err(newResolved.error);
        const oldBase = oldResolved.value;
        const newBase = newResolved.value;
        const escaped = ScopePrefix.escapeLike(oldBase);
        const childPattern = `${escaped}/%`;
        // 两条 UPDATE 放进同一事务，避免 dir_rule 成功而 file_rule 失败时留下半套状态。
        // 注意：TDBC 事务不可嵌套——目前唯一调用方（createWorkplaceService 的默认连接）
        // 在此处是非事务连接，安全；若未来有调用方把本方法放进外层事务，需改成“复用外层 tx”。
        await this.conn.transaction(async (tx) => {
            await TdbcTemplate.execute(tx, this.parser, WorkplaceDirRuleSql.renameRulesUnderLogicalPrefix, {
                scopeKey,
                oldBase,
                newBase,
                childPattern,
            });
            await TdbcTemplate.execute(tx, this.parser, WorkplaceFileRuleSql.renameRulesUnderLogicalPrefix, {
                scopeKey,
                oldBase,
                newBase,
                childPattern,
            });
        });
        return Result.ok(undefined);
    }
}
