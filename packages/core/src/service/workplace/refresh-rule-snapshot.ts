/**
 * 规则保存后刷新会话规则快照并清空文件缓存。
 *
 * @module service/workplace/refresh-rule-snapshot
 */

import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  ruleViewToSnapshotEntries,
  serializeRuleSnapshot,
} from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

/** {@link refreshRuleSnapshot} 依赖面。 */
export type RefreshRuleSnapshotDeps = {
  readonly sessionKkv: Pick<SessionKkvService, "set" | "clearDomain">;
  readonly workplace: Pick<WorkplaceService, "evaluateRuleView">;
};

/**
 * 规则保存后：evaluate → 写 `rule_snapshot`/`canon` → `clearDomain(file_cache)`。
 * 不改 Composer attachments（投影已无 workplace 半边，无规则 chip）。
 */
export async function refreshRuleSnapshot(
  sessionId: string,
  deps: RefreshRuleSnapshotDeps
): Promise<Result<void, AppError>> {
  const view = await deps.workplace.evaluateRuleView();
  if (!view.ok) return Result.err(view.error);
  const entries = ruleViewToSnapshotEntries(view.value);
  await deps.sessionKkv.set(
    sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
    serializeRuleSnapshot(entries)
  );
  await deps.sessionKkv.clearDomain(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
  return Result.ok(undefined);
}
