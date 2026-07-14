/**
 * 异步 hydrate + wrap 用户消息附件；LLM / 预览 / token 的唯一拼装入口。
 *
 * @module domain/chat/logic/prepare-user-messages-for-prompt
 */

import {
  fileCacheKey,
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  parseFileCachePayload,
  parseRuleSnapshotJson,
  serializeFileCachePayload,
} from "@/domain/worktree/logic/rule-snapshot-codec.js";
import { renderFileBlock } from "@/domain/worktree/logic/worktree-display.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { messageBodyTextFromContent } from "../content/message-body-text.js";
import { textBlocks } from "../content/text-blocks.js";
import type { ChatMessage } from "../model/message.js";
import type { MessageAttachment } from "../model/message-attachment.schema.js";
import {
  isBinaryAttachPath,
  isImageAttachPath,
} from "./attach-binary-heuristic.js";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";

/** {@link prepareUserMessagesForPrompt} 运行时依赖。 */
export interface PrepareUserMessagesForPromptRuntime {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
}

async function resolveWorkplaceStatus(
  path: string,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<WorkplaceDisplayStatus> {
  const raw = await runtime.sessionKkv.get(
    runtime.sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
  );
  if (raw == null || raw === "") {
    return "full";
  }
  const entries = parseRuleSnapshotJson(raw);
  if (entries == null) {
    return "full";
  }
  const hit = entries.find((e) => e.path === path);
  return hit?.status ?? "full";
}

function resolveAttachFileStatus(
  path: string,
  type: MessageAttachment["type"],
): WorkplaceDisplayStatus {
  if (type === "image" || isBinaryAttachPath(path) || isImageAttachPath(path)) {
    return "filename";
  }
  return "full";
}

async function loadOrFillFileCache(
  path: string,
  status: WorkplaceDisplayStatus,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<{ body: string; mtimeMs: number }> {
  const key = fileCacheKey(status, path);
  const raw = await runtime.sessionKkv.get(
    runtime.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
  );
  if (raw != null) {
    const parsed = parseFileCachePayload(raw);
    if (parsed != null) {
      return parsed;
    }
  }

  let body = "";
  let mtimeMs = 0;
  if (status === "filename") {
    body = "";
    mtimeMs = 0;
  } else {
    try {
      const result = await runtime.vfs.read(path);
      body = result.content;
      mtimeMs = result.mtimeMs;
    } catch {
      body = "(missing)";
      mtimeMs = 0;
    }
  }

  await runtime.sessionKkv.set(
    runtime.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload({ body, mtimeMs }),
  );
  return { body, mtimeMs };
}

async function hydrateAttachment(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<MessageAttachment> {
  if (attachment.source === "user_ops") {
    return attachment;
  }

  if (attachment.type === "dir") {
    const path = attachment.path;
    if (path == null || path === "") {
      return attachment;
    }
    if (attachment.content != null) {
      return attachment;
    }
    const tree = await renderDirAttachTree(path, {
      sessionId: runtime.sessionId,
      sessionKkv: runtime.sessionKkv,
      vfs: runtime.vfs,
    });
    return { ...attachment, content: tree };
  }

  if (attachment.content != null) {
    // 已有正文：若尚未是 file 块，按 path 再包一层展示块
    if (attachment.content.includes("<file ") || attachment.path == null) {
      return attachment;
    }
    const status =
      attachment.source === "workplace"
        ? await resolveWorkplaceStatus(attachment.path, runtime)
        : resolveAttachFileStatus(attachment.path, attachment.type);
    return {
      ...attachment,
      content: renderFileBlock({
        logicalPath: attachment.path,
        mtimeMs: 0,
        display: status,
        content: attachment.content,
      }),
    };
  }

  const path = attachment.path;
  if (path == null || path === "") {
    return attachment;
  }

  const status =
    attachment.source === "workplace"
      ? await resolveWorkplaceStatus(path, runtime)
      : resolveAttachFileStatus(path, attachment.type);

  const cached = await loadOrFillFileCache(path, status, runtime);
  return {
    ...attachment,
    content: renderFileBlock({
      logicalPath: path,
      mtimeMs: cached.mtimeMs,
      display: status,
      content: cached.body,
    }),
  };
}

async function prepareOneUserMessage(
  message: ChatMessage,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<ChatMessage> {
  if (message.hidden) {
    // hidden：不 hydrate/wrap；库内 attachments 保留在原消息上
    return message;
  }

  const attachments = message.attachments;
  if (attachments == null || attachments.length === 0) {
    return message;
  }

  const hydrated: MessageAttachment[] = [];
  for (const att of attachments) {
    hydrated.push(await hydrateAttachment(att, runtime));
  }

  const plainText = messageBodyTextFromContent(message.content);
  const wrapped = wrapUserMessageForLlm(plainText, hydrated);

  return {
    ...message,
    content: textBlocks(wrapped),
    // wrap 后仍保留 attachments，供 normalizeForLlmExport 禁 merge
    attachments: hydrated,
  };
}

/**
 * 遍历 messages：跳过 hidden 的 hydrate/wrap；对非 hidden user 做附件 hydrate + wrap。
 *
 * **不写回** `content_json`；仅返回内存侧 messages。
 * 非 user / 无附件消息原样通过。
 */
export async function prepareUserMessagesForPrompt(
  messages: readonly ChatMessage[],
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      out.push(message);
      continue;
    }
    out.push(await prepareOneUserMessage(message, runtime));
  }
  return out;
}
