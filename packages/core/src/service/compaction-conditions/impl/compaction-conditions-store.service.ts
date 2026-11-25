/**
 * KKV-backed compaction conditions store (`nm-compaction-conditions`).
 *
 * @module service/compaction-conditions/impl/compaction-conditions-store.service
 */

import { SerializationDecode } from "@/common/serialization/decode.js";
import { compactionConditionsSchema } from "@/domain/compaction-conditions/model/compaction-conditions.schema.js";
import { DEFAULT_HIDE_START_DEPTH, type CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import { AppError, AppErrorOps } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { CompactionConditionsStore } from "../compaction-conditions-store.port.js";

const MODULE = "nm-compaction-conditions";
const KEY_POLICY = "policy";

/** v2/v3 文档的 visibleFloor 兼容两种键（camelCase 与历史 kebab-case）。 */
function visibleFloorOf(doc: Record<string, unknown>): number | undefined {
    if (typeof doc.visibleFloor === "number") {
        return doc.visibleFloor;
    }
    if (typeof doc["visible-floor"] === "number") {
        return doc["visible-floor"] as number;
    }
    return undefined;
}

/** decode 失败转码：CONFIG_DECODE_INVALID_SCHEMA → 本域码。 */
function invalidSchemaError(error: AppError): AppError {
    return new AppError("COMPACTION_CONDITIONS_INVALID_SCHEMA", { detail: error.message });
}

export class DefaultCompactionConditionsStore implements CompactionConditionsStore {
    constructor(private readonly kkv: KkvService) {}

    async getConditions(): Promise<Result<CompactionConditions | null, AppError>> {
        const raw = await this.kkv.get(MODULE, KEY_POLICY);
        if (!raw.ok && !AppErrorOps.is(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
        if (!raw.ok) return Result.ok(null);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw.value) as unknown;
        } catch (error) {
            return Result.err(new AppError("COMPACTION_CONDITIONS_INVALID_SCHEMA", { detail: `invalid JSON in nm-compaction-conditions/policy: ${error instanceof Error ? error.message : String(error)}` }));
        }
        if (parsed != null && typeof parsed === "object") {
            const doc = parsed as Record<string, unknown>;
            if (doc.schemaVersion === 2 || doc.tokenThreshold != null) {
                // v2 → v4 一步等价于旧的 v2→v3→v4：先归一化 visibleFloor/tokenRatio，再补 hideStartDepth。
                const visibleFloor = visibleFloorOf(doc);
                const migrated = {
                    schemaVersion: 4,
                    enabled: Boolean(doc.enabled),
                    tokenRatio: typeof doc.tokenRatio === "number" ? doc.tokenRatio : 0.8,
                    ...(visibleFloor != null ? { visibleFloor } : {}),
                    hideStartDepth: DEFAULT_HIDE_START_DEPTH,
                };
                const validated = SerializationDecode.decode(migrated, compactionConditionsSchema);
                if (!validated.ok) return Result.err(invalidSchemaError(validated.error));
                await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated.value));
                return Result.ok(validated.value);
            }
            if (doc.schemaVersion === 3) {
                // v3 → v4：补 hideStartDepth 默认值（与历史事件配置默认值一致），
                // 其余字段原样带入，约束交给 compactionConditionsSchema 兜底。
                const visibleFloor = visibleFloorOf(doc);
                const tokenRatio = typeof doc.tokenRatio === "number" ? doc.tokenRatio : undefined;
                const migrated = {
                    schemaVersion: 4,
                    enabled: Boolean(doc.enabled),
                    ...(tokenRatio != null ? { tokenRatio } : {}),
                    ...(visibleFloor != null ? { visibleFloor } : {}),
                    hideStartDepth: DEFAULT_HIDE_START_DEPTH,
                };
                const validated = SerializationDecode.decode(migrated, compactionConditionsSchema);
                if (!validated.ok) return Result.err(invalidSchemaError(validated.error));
                await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated.value));
                return Result.ok(validated.value);
            }
        }
        const direct = SerializationDecode.decode(parsed, compactionConditionsSchema);
        if (!direct.ok) return Result.err(invalidSchemaError(direct.error));
        return Result.ok(direct.value);
    }

    async setConditions(conditions: CompactionConditions): Promise<void> {
        const validated = SerializationDecode.decode(conditions, compactionConditionsSchema);
        // 端口无失败位、apps set 路径按异常收口：schema 违约在写入口仍走 throw（边界决定，见 port 注）。
        if (!validated.ok) throw invalidSchemaError(validated.error);
        await this.kkv.set(MODULE, KEY_POLICY, JSON.stringify(validated.value));
    }

    /** nm-style: keep-public — CompactionConditionsStore 端口方法；CLI `nm compaction-conditions clear` 单点消费。 */
    async clearConditions(): Promise<void> {
        try {
            await this.kkv.delete(MODULE, KEY_POLICY);
        } catch (error) {
            if (AppErrorOps.is(error, "KKV_NOT_FOUND")) {
                return;
            }
            throw error;
        }
    }
}
