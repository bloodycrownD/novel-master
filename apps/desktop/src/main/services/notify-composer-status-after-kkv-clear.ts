/**
 * session kkv 清空后：清空 Composer 状态条并推送给 renderer。
 * 不清 composer_draft（正文+attach 保留）。
 *
 * 不可再 projectComposerStatus：file_cache 已空时规则差集会灌满全部 live path。
 */
import { notifyComposerAttachmentsSuggestToRenderer } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export async function notifyComposerStatusAfterSessionKkvCleared(
  _rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  notifyComposerAttachmentsSuggestToRenderer({
    sessionId,
    attachments: [],
  });
}
