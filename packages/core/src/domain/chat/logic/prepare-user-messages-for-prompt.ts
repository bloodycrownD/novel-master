/**
 * 异步 hydrate + wrap 用户消息附件；LLM / 预览 / token 的唯一拼装入口。
 *
 * 按可见序共享「已出现路径」：常驻前缀 S0 → attach → workplace（历史只读兼容）；user_ops 不参与。
 * 文件 attach 非首次 → alreadyReferenced 短提示；workplace 非首次 → content 空；目录每次拼树仍计 seen。
 * skillAttach（`$技能名`）走 `skill:{name}` 命名空间 seen：首次读生效副本 SKILL.md 全文
 * （跨域读不经 session file_cache，直接 SkillService）；不存在 → 一行提示且不写 seen（自愈）；
 * 常驻索引不计入「已出现」，被压缩/置位重置随可见窗口自动继承。
 * 增量统一为 `<action name="userAttach|workplaceChange|…">` + JSON（行号正文；无 mtime/createdAt）。
 * `runtime.extraInfo`（来自 agent 配置 customAttach）非空时，仅对本次请求里最新一条
 * 非隐藏 user 输入消息生效——wrap 阶段在 `</user-ops>` 后注入 `<extra-info>` 纯文本块；
 * 历史 user 消息不再注入（与 dynamic 区 once 语义不同，独立实现）。
 *
 * @module domain/chat/logic/prepare-user-messages-for-prompt
 */

import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { loadOrFillFileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import { parseRuleSnapshotJson } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { renderFileBlockBody } from "@/domain/workplace/logic/workplace-display.js";
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
import { isUserInputMessage } from "./message-content-helpers.js";
import {
  buildAlreadyReferencedActionXml,
  buildAttachmentActionXml,
  buildDirTreeActionXml,
  buildFileRefActionXml,
} from "./build-attachment-action-xml.js";
import {
  createPromptPathSeenSet,
  tryNormalizePromptSeenPath,
} from "./prompt-path-seen.js";
import { skillSeenKey } from "./scan-skill-attachments.js";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";
import { expandDynamicMacros } from "@/domain/prompt/logic/expand-dynamic-macros.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";

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
  /**
   * 自定义附加信息（agent 配置 customAttach，**未展开宏的原文本**）；
   * trim 非空时在 prepare 入口经 {@link expandDynamicMacros} 展开宏后，由 wrap 阶段注入 `<extra-info>` 块。
   */
  readonly extraInfo?: string;
  /** 宏展开所需的当前时间（默认取 new Date()）。 */
  readonly now?: Date;
  /** 宏展开所需的 workplace 服务（用于 $filetree 实时渲染）。 */
  readonly workplace?: WorkplaceService;
  /** 回合快照的 `{{$filetree}}` 预渲染结果；传入时优先于实时渲染。 */
  readonly filetree?: string;
  /**
   * 技能服务（skillAttach 附件 hydrate 用）。缺省时 skillAttach 附件原样带过
   * （不读盘、不写 seen），调用方接线后自动生效。
   */
  readonly skills?: SkillService;
  /** skillAttach 存在性判定与生效副本读取的解析上下文。 */
  readonly projectId?: string;
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

function fileRefAction(
  source: "attach" | "workplace",
  logicalPath: string,
  display: WorkplaceDisplayStatus,
  rawContent: string,
): string {
  const lineBody = renderFileBlockBody({
    logicalPath,
    display,
    content: rawContent,
  });
  return buildFileRefActionXml({
    action: source === "workplace" ? "workplaceChange" : "userAttach",
    path: logicalPath,
    content: lineBody,
    display,
  });
}

/** 首次全文 hydrate（文本 / workplace / filename 档）→ action XML。 */
async function hydrateFileFull(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<MessageAttachment> {
  const action =
    attachment.source === "workplace" ? "workplaceChange" as const : "userAttach" as const;

  if (attachment.content != null) {
    // 已是 action XML → 原样带过
    if (attachment.content.includes("<action ")) {
      return {
        ...attachment,
        path: logicalPath,
        action: attachment.action ?? action,
      };
    }
    // 旧 `<file>` 或裸正文：若含外壳则剥掉再包 action（对齐 hydrateDirAttach）
    const status =
      attachment.source === "workplace"
        ? await resolveWorkplaceStatus(logicalPath, runtime)
        : resolveAttachFileStatus(logicalPath, attachment.type);
    const trimmed = attachment.content.trim();
    const wasLegacyFile =
      trimmed.startsWith("<file ") && trimmed.endsWith("</file>");
    const fileBody = stripLegacyFileWrap(attachment.content, logicalPath);
    // 旧块内层已是展示正文（含行号），勿再 contentLines；裸正文走 fileRefAction
    const content = wasLegacyFile
      ? buildFileRefActionXml({
          action,
          path: logicalPath,
          content: fileBody,
          display: status,
        })
      : fileRefAction(
          attachment.source === "workplace" ? "workplace" : "attach",
          logicalPath,
          status,
          fileBody,
        );
    return {
      ...attachment,
      path: logicalPath,
      action,
      content,
    };
  }

  const status =
    attachment.source === "workplace"
      ? await resolveWorkplaceStatus(logicalPath, runtime)
      : resolveAttachFileStatus(logicalPath, attachment.type);

  const cached = await loadOrFillFileCache({
    sessionId: runtime.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs: runtime.vfs,
    path: logicalPath,
    status,
  });
  return {
    ...attachment,
    path: logicalPath,
    action,
    content: fileRefAction(
      attachment.source === "workplace" ? "workplace" : "attach",
      logicalPath,
      status,
      cached.body,
    ),
  };
}

async function hydrateDirAttach(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime,
): Promise<MessageAttachment> {
  if (attachment.content != null) {
    if (attachment.content.includes("<action ")) {
      return {
        ...attachment,
        path: logicalPath,
        action: attachment.action ?? "userAttach",
      };
    }
    // 旧 `<dir>` 或已拼好的 ASCII：若含外壳则剥掉再包 action
    const treeBody = stripLegacyDirWrap(attachment.content, logicalPath);
    return {
      ...attachment,
      path: logicalPath,
      action: "userAttach",
      content: buildDirTreeActionXml(logicalPath, treeBody),
    };
  }
  const tree = await renderDirAttachTree(logicalPath, {
    sessionId: runtime.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs: runtime.vfs,
  });
  return {
    ...attachment,
    path: logicalPath,
    action: "userAttach",
    content: buildDirTreeActionXml(logicalPath, tree),
  };
}

function stripLegacyDirWrap(content: string, logicalPath: string): string {
  const trimmed = content.trim();
  const open = `<dir path="${logicalPath}">`;
  if (trimmed.startsWith("<dir ") && trimmed.endsWith("</dir>")) {
    const firstNl = trimmed.indexOf("\n");
    const lastNl = trimmed.lastIndexOf("\n");
    if (firstNl >= 0 && lastNl > firstNl) {
      return trimmed.slice(firstNl + 1, lastNl);
    }
    // 退化：去掉首尾标签行
    return trimmed
      .replace(/^<dir\b[^>]*>\s*/i, "")
      .replace(/\s*<\/dir>\s*$/i, "");
  }
  void open;
  return trimmed;
}

/** 剥旧增量外壳 `<file …>…</file>`，取内层正文；非外壳则原样返回。 */
function stripLegacyFileWrap(content: string, logicalPath: string): string {
  const trimmed = content.trim();
  const open = `<file path="${logicalPath}">`;
  if (trimmed.startsWith("<file ") && trimmed.endsWith("</file>")) {
    const firstNl = trimmed.indexOf("\n");
    const lastNl = trimmed.lastIndexOf("\n");
    if (firstNl >= 0 && lastNl > firstNl) {
      return trimmed.slice(firstNl + 1, lastNl);
    }
    return trimmed
      .replace(/^<file\b[^>]*>\s*/i, "")
      .replace(/\s*<\/file>\s*$/i, "");
  }
  void open;
  return trimmed;
}

/** skillAttach 不存在 / 读盘竞态失败时的一行提示（不附全文）。 */
const SKILL_ATTACH_MISSING_NOTE = "技能不存在或已删除";

/** skillAttach 不存在提示行 XML（不写 seen：技能后续创建可自愈重附全文）。 */
function buildSkillAttachMissingXml(name: string): string {
  return buildAttachmentActionXml("skillAttach", {
    name,
    missing: true,
    note: SKILL_ATTACH_MISSING_NOTE,
  });
}

/**
 * skillAttach 附件：skill:{name} 命名空间 seen（与路径 seen 同集合）。
 * 首次读生效副本 SKILL.md 全文；非首次 alreadyReferenced 短标记；
 * 存在性按合并视图（含无效技能，禁用不影响）判定，不存在 → 一行提示且不写 seen。
 * skills 服务未接线时原样带过（不读盘、不写 seen）。
 */
async function hydrateSkillAttachWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  resolveSkillNames: () => Promise<Set<string>>,
): Promise<MessageAttachment> {
  const name = attachment.skillName;
  if (typeof name !== "string" || name === "") {
    return attachment;
  }
  const key = skillSeenKey(name);
  if (seen.has(key)) {
    return {
      ...attachment,
      action: "skillAttach",
      content: buildAttachmentActionXml("skillAttach", {
        name,
        alreadyReferenced: true,
      }),
    };
  }
  if (runtime.skills == null || runtime.projectId == null) {
    return attachment;
  }
  // 存在性按合并视图（global ∪ 当前项目，含无效技能；禁用不影响）
  const names = await resolveSkillNames();
  if (!names.has(name)) {
    return { ...attachment, action: "skillAttach", content: buildSkillAttachMissingXml(name) };
  }
  try {
    // 跨域读不经 session file_cache：直接读生效副本 SKILL.md 全文（含无效技能原文）
    const file = await runtime.skills.readSkillFile(
      undefined,
      name,
      undefined,
      runtime.projectId,
    );
    seen.add(key);
    return {
      ...attachment,
      action: "skillAttach",
      content: buildAttachmentActionXml("skillAttach", {
        name,
        content: file.content,
      }),
    };
  } catch {
    // 存在性判定与读盘之间被删除等竞态：按不存在处理（不写 seen）
    return { ...attachment, action: "skillAttach", content: buildSkillAttachMissingXml(name) };
  }
}

/**
 * attach 源：目录每次树；文本首次全文 / 其后短提示；image/binary 不套短提示仍计 seen；
 * skillAttach 走技能专用 hydrate（skill: 命名空间）。
 */
async function hydrateAttachWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  resolveSkillNames: () => Promise<Set<string>>,
): Promise<MessageAttachment> {
  // skillAttach：无 path，不走路径规范化/文件 hydrate
  if (attachment.action === "skillAttach") {
    return hydrateSkillAttachWithSeen(attachment, runtime, seen, resolveSkillNames);
  }
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
      action: "userAttach",
      content: buildAlreadyReferencedActionXml(logicalPath),
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
    return {
      ...attachment,
      path: logicalPath,
      action: "workplaceChange",
      content: "",
    };
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
  isLatestUser: boolean,
  resolveSkillNames: () => Promise<Set<string>>,
): Promise<ChatMessage> {
  if (message.hidden) {
    // hidden：不 hydrate/wrap；库内 attachments 保留在原消息上
    return message;
  }

  // extra info（customAttach）只对最新一条 user 消息拼接：历史消息不注入。
  // 与 dynamic 区 once 语义不同——这里是注入位收窄，不是块级去重。
  const effectiveExtraInfo = isLatestUser ? runtime.extraInfo : undefined;
  const attachments = message.attachments ?? [];
  const hasExtraInfo =
    typeof effectiveExtraInfo === "string" &&
    effectiveExtraInfo.trim().length > 0;
  // 无附件且无 extraInfo：恒等原文，不走 wrap。
  if (attachments.length === 0 && !hasExtraInfo) {
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
      await hydrateAttachWithSeen(att, runtime, seen, resolveSkillNames),
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
  const wrapped = wrapUserMessageForLlm(plainText, hydrated, effectiveExtraInfo);

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
  // 每轮 prepare 展开一次 customAttach 宏（与 dynamic 区每步展开对齐），同一轮内所有 user 消息复用同一份文本。
  const extraInfoResolved =
    typeof runtime.extraInfo === "string" &&
    runtime.extraInfo.trim().length > 0
      ? await expandDynamicMacros(runtime.extraInfo, {
          now: runtime.now,
          workplace: runtime.workplace,
          filetree: runtime.filetree,
        })
      : undefined;
  const resolvedRuntime: PrepareUserMessagesForPromptRuntime =
    extraInfoResolved === undefined
      ? runtime
      : { ...runtime, extraInfo: extraInfoResolved };
  // extra info 只对最新一条 user 输入消息生效：反向扫一遍找最后一条
  // role==='user' && isUserInputMessage(message) && !message.hidden 的 index。
  // hidden 不计入（不进输出）；非用户输入的 user 消息（tool_result）也不计入。
  let latestUserInputIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.role === "user" &&
      !m.hidden &&
      isUserInputMessage(m)
    ) {
      latestUserInputIndex = i;
      break;
    }
  }
  const out: ChatMessage[] = [];
  // 每轮 prepare 预算一次合并视图技能名集合（skillAttach 存在性判定用）；
  // 惰性求值——本轮没有命中存在性判定的 skillAttach 时不产生 IO
  let skillNames: Promise<Set<string>> | null = null;
  const resolveSkillNames = (): Promise<Set<string>> => {
    skillNames ??= (async () => {
      if (runtime.skills == null || runtime.projectId == null) {
        return new Set<string>();
      }
      try {
        const list = await runtime.skills.effectiveSkills(runtime.projectId);
        return new Set(list.map((s) => s.name));
      } catch {
        return new Set<string>();
      }
    })();
    return skillNames;
  };
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "user") {
      out.push(message);
      continue;
    }
    // 非用户输入的 user 消息（含 tool_result 的工具结果）直接透传，不走 wrap——
    // wrap 会把 block 类型拍平成 text，导致 LLM API 报 tool 配对错误。
    if (!isUserInputMessage(message)) {
      out.push(message);
      continue;
    }
    out.push(
      await prepareOneUserMessage(
        message,
        resolvedRuntime,
        seen,
        i === latestUserInputIndex,
        resolveSkillNames,
      ),
    );
  }
  return out;
}
