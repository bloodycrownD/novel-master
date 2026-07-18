/**
 * 异步 hydrate + wrap 用户消息附件；LLM / 预览 / token 的唯一拼装入口。
 *
 * 按可见序共享「已出现路径」：常驻前缀 S0 → attach → workplace；user_ops 不参与。
 * 文件 attach 非首次 → 短提示；workplace 非首次 → content 空；目录每次拼树仍计 seen。
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
import {
  createPromptPathSeenSet,
  renderPromptFileSeenShortTip,
  tryNormalizePromptSeenPath,
} from "./prompt-path-seen.js";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";

/** {@link prepareUserMessagesForPrompt} 运行时依赖与可选初始 seen。 */
export interface PrepareUserMessagesForPromptRuntime {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  /**
   * 常驻前缀 path 集合 S0（已或未规范化均可）；prepare 内再规范化后写入 seen。
   * 通常来自 `assembleWorkplaceDisplay().prefixPaths`。
   */
  readonly seenPaths?: readonly string[];
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

function isBinaryOrImageAttach(attachment: MessageAttachment): boolean {
  if (attachment.type === "image" || attachment.type === "dir") {
    return attachment.type === "image";
  }
  const path = attachment.path ?? "";
  return isBinaryAttachPath(path) || isImageAttachPath(path);
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

/** 首次全文 hydrate（文本 / workplace / filename 档）。 */
async function hydrateFileFull(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<MessageAttachment> {
  if (attachment.content != null) {
    if (attachment.content.includes("<file ") || attachment.path == null) {
      return { ...attachment, path: logicalPath };
    }
    const status =
      attachment.source === "workplace"
        ? await resolveWorkplaceStatus(logicalPath, runtime)
        : resolveAttachFileStatus(logicalPath, attachment.type);
    return {
      ...attachment,
      path: logicalPath,
      content: renderFileBlock({
        logicalPath,
        mtimeMs: 0,
        display: status,
        content: attachment.content,
      }),
    };
  }

  const status =
    attachment.source === "workplace"
      ? await resolveWorkplaceStatus(logicalPath, runtime)
      : resolveAttachFileStatus(logicalPath, attachment.type);

  const cached = await loadOrFillFileCache(logicalPath, status, runtime);
  return {
    ...attachment,
    path: logicalPath,
    content: renderFileBlock({
      logicalPath,
      mtimeMs: cached.mtimeMs,
      display: status,
      content: cached.body,
    }),
  };
}

async function hydrateDirAttach(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<MessageAttachment> {
  if (attachment.content != null) {
    return { ...attachment, path: logicalPath };
  }
  const tree = await renderDirAttachTree(logicalPath, {
    sessionId: runtime.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs: runtime.vfs,
  });
  return { ...attachment, path: logicalPath, content: tree };
}

/**
 * attach 源：目录每次树；文本首次全文 / 其后短提示；image/binary 不套短提示仍计 seen。
 */
async function hydrateAttachWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
): Promise<MessageAttachment> {
  const rawPath = attachment.path;
  if (rawPath == null || rawPath === "") {
    return attachment;
  }
  const logicalPath = tryNormalizePromptSeenPath(rawPath);
  if (logicalPath == null) {
    return attachment;
  }

  if (attachment.type === "dir") {
    const out = await hydrateDirAttach(attachment, logicalPath, runtime);
    seen.add(logicalPath);
    return out;
  }

  const alreadySeen = seen.has(logicalPath);
  seen.add(logicalPath);

  if (isBinaryOrImageAttach(attachment)) {
    // 非首次仍 filename 档，不套中文短提示
    return hydrateFileFull(
      { ...attachment, path: logicalPath },
      logicalPath,
      runtime,
    );
  }

  if (alreadySeen) {
    return {
      ...attachment,
      path: logicalPath,
      content: renderPromptFileSeenShortTip(logicalPath),
    };
  }

  return hydrateFileFull(
    { ...attachment, path: logicalPath },
    logicalPath,
    runtime,
  );
}

/**
 * workplace 源：首次全文；非首次 content 空（wrap 省略）。
 */
async function hydrateWorkplaceWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
): Promise<MessageAttachment> {
  const rawPath = attachment.path;
  if (rawPath == null || rawPath === "") {
    return attachment;
  }
  const logicalPath = tryNormalizePromptSeenPath(rawPath);
  if (logicalPath == null) {
    return attachment;
  }

  if (seen.has(logicalPath)) {
    return { ...attachment, path: logicalPath, content: "" };
  }
  seen.add(logicalPath);
  return hydrateFileFull(
    { ...attachment, path: logicalPath },
    logicalPath,
    runtime,
  );
}

async function prepareOneUserMessage(
  message: ChatMessage,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
): Promise<ChatMessage> {
  if (message.hidden) {
    // hidden：不 hydrate/wrap；库内 attachments 保留在原消息上
    return message;
  }

  const attachments = message.attachments;
  if (attachments == null || attachments.length === 0) {
    return message;
  }

  // 单条内固定 attach → workplace → user_ops，不依赖落库数组序
  const attachList = attachments.filter((a) => a.source === "attach");
  const workplaceList = attachments.filter((a) => a.source === "workplace");
  const userOpsList = attachments.filter((a) => a.source === "user_ops");

  const hydratedBySource = new Map<MessageAttachment, MessageAttachment>();

  for (const att of attachList) {
    hydratedBySource.set(
      att,
      await hydrateAttachWithSeen(att, runtime, seen),
    );
  }
  for (const att of workplaceList) {
    hydratedBySource.set(
      att,
      await hydrateWorkplaceWithSeen(att, runtime, seen),
    );
  }
  for (const att of userOpsList) {
    // user_ops 原样带过，不参与 path 首次判定
    hydratedBySource.set(att, att);
  }

  // 保持原 attachments 数组序（仅内容已按 source 优先级处理）
  const hydrated: MessageAttachment[] = attachments.map(
    (a) => hydratedBySource.get(a) ?? a,
  );

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
 *
 * @param runtime.seenPaths 常驻前缀 S0；应在 assemble 之后传入。
 */
export async function prepareUserMessagesForPrompt(
  messages: readonly ChatMessage[],
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<ChatMessage[]> {
  const seen = createPromptPathSeenSet(runtime.seenPaths);
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      out.push(message);
      continue;
    }
    out.push(await prepareOneUserMessage(message, runtime, seen));
  }
  return out;
}
