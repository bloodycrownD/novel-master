/**
 * Composer 状态条投影：workplace 差集 + user_ops 净 action → MessageAttachment[]。
 *
 * @module domain/chat/logic/project-composer-status-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  workplaceAttachmentsFromRuleDelta,
  type WorkplaceLivePath,
} from "@/domain/workplace/logic/diff-workplace-paths.js";
import { userOpsAttachmentsFromSummaries } from "./build-user-ops-attachment.js";
import type { UserOpsActionSummary } from "./synthesize-user-vfs-flush-actions.js";

/** `projectComposerStatusAttachments` 所需依赖（不绑定完整 Service）。 */
export type ProjectComposerStatusAttachmentsDeps = {
  readonly sessionKkv: {
    listKeys(sessionId: string, domain: string): Promise<string[]>;
  };
  /**
   * 常驻工作区开关（与 assembleWorkplaceDisplay 同源）。
   * `workplace !== true` 时不投影 workplace 差集；user_ops 仍投影。
   */
  readonly layout: Pick<AgentPromptLayout, "workplace">;
  /** live 规则可见 path；现网可由 evaluateRuleView → ruleViewToSnapshotEntries。 */
  readonly loadLiveWorkplacePaths: () => Promise<
    readonly WorkplaceLivePath[]
  >;
  /** 相对 checkpoint 的净 action 摘要（须走 preview，禁止 flush）。 */
  readonly previewUserOpsActions: (
    sessionId: string,
  ) => Promise<readonly UserOpsActionSummary[]>;
};

/**
 * 由 live / cacheKeys / user_ops 摘要合成状态条附件（纯函数，便于 T-WP1）。
 */
export function buildComposerStatusAttachments(
  live: readonly WorkplaceLivePath[],
  cacheKeys: ReadonlySet<string> | readonly string[],
  userOpsActions: readonly UserOpsActionSummary[],
): MessageAttachment[] {
  return [
    ...workplaceAttachmentsFromRuleDelta(live, cacheKeys),
    ...userOpsAttachmentsFromSummaries(userOpsActions),
  ];
}

/**
 * 用投影结果整表替换 Composer draft attachments。
 * draft attach 恒空：不再保留 existing attach，仅返回 statusProjected。
 */
export function replaceComposerStatusAttachments(
  _existing: readonly MessageAttachment[],
  statusProjected: readonly MessageAttachment[],
): MessageAttachment[] {
  return [...statusProjected];
}

/**
 * session 真源 → Composer 状态条 `MessageAttachment[]`（workplace + user_ops）。
 * 关常驻（`layout.workplace !== true`）时不加载/不投影 workplace 源。
 */
export async function projectComposerStatusAttachments(
  sessionId: string,
  deps: ProjectComposerStatusAttachmentsDeps,
): Promise<MessageAttachment[]> {
  if (deps.layout.workplace !== true) {
    const userOpsActions = await deps.previewUserOpsActions(sessionId);
    return buildComposerStatusAttachments([], [], userOpsActions);
  }
  const [live, cacheKeys, userOpsActions] = await Promise.all([
    deps.loadLiveWorkplacePaths(),
    deps.sessionKkv.listKeys(sessionId, SESSION_KKV_DOMAIN_FILE_CACHE),
    deps.previewUserOpsActions(sessionId),
  ]);
  return buildComposerStatusAttachments(live, cacheKeys, userOpsActions);
}
