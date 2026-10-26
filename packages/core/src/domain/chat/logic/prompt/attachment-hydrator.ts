/**
 * 用户消息附件 hydrate 领域服务。
 *
 * `seen`、`workplaceSeen`、`AttachBudget`、技能名解析器是整轮 prepare 共享的可变状态；
 * 因此这里用对象持有状态，而不是继续堆一排把同一组参数传来传去的自由函数。
 */

import { RULE_SNAPSHOT_CANON_KEY, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, type WorkplaceDisplayStatus } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { loadOrFillFileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import { parseRuleSnapshotJson } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { renderFileBlockBody } from "@/domain/workplace/logic/workplace-display.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { isBinaryFilePath } from "@/common/file.js";
import { messageBodyTextFromBlocks } from "../../content/message-body-text.js";
import { textBlocks } from "../../content/text-blocks.js";
import type { ChatMessageData } from "../../model/message.js";
import type { MessageAttachment } from "../../model/message-attachment.schema.js";
import { AttachBudget, BINARY_ATTACH_NOTE, OVERSIZED_ATTACH_NOTE } from "../attachment/attach-budget.js";
import { attachmentXmlCodec } from "../attachment/attachment-xml-codec.js";
import { buildUserVfsActionXml } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import { promptPathSeen } from "../attachment/prompt-path-seen.js";
import { attachmentScanner } from "../attachment/attachment-scanner.js";
import { dirAttachTreeRenderer } from "../attachment/render-dir-attach-tree.js";
import { userMessageFormatter } from "./user-message-formatter.js";

/** hydrate 所需的最小运行时依赖。 */
export interface AttachmentHydratorRuntime {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  readonly extraInfo?: string;
  readonly skills?: SkillService;
  readonly projectId?: string;
}

/** skillAttach 不存在 / 读盘竞态失败时的一行提示。 */
const SKILL_ATTACH_MISSING_NOTE = "技能不存在或已删除";

async function resolveWorkplaceStatus(path: string, runtime: AttachmentHydratorRuntime): Promise<WorkplaceDisplayStatus> {
  const raw = await runtime.sessionKkv.get(runtime.sessionId, SESSION_KKV_DOMAIN_RULE_SNAPSHOT, RULE_SNAPSHOT_CANON_KEY);
  if (raw == null || raw === "") return "full";
  const entries = parseRuleSnapshotJson(raw);
  if (!entries.ok) return "full";
  return entries.value.find((entry) => entry.path === path)?.status ?? "full";
}

function resolveAttachFileStatus(path: string, type: MessageAttachment["type"]): WorkplaceDisplayStatus {
  if (type === "image" || isBinaryFilePath(path)) return "filename";
  return "full";
}

function isBinaryOrImageAttach(attachment: MessageAttachment): boolean {
  if (attachment.type === "image" || attachment.type === "dir") return attachment.type === "image";
  const path = attachment.path ?? "";
  return isBinaryFilePath(path);
}

/** {@link fileRefAction} 的可选正文口径开关。 */
interface FileRefActionOpts {
  readonly noteText?: string;
  readonly bodyIsRendered?: boolean;
  readonly oversized?: boolean;
}

/**
 * 文件附件的唯一 action XML 出口：正文口径（行号正文 / 二进制文案 / 超限降级）
 * 全部集中于此，避免各分支各写一份 `buildFileRefActionXml` 走形。
 */
function fileRefAction(source: "attach" | "workplace", logicalPath: string, display: WorkplaceDisplayStatus, rawContent: string, opts?: FileRefActionOpts): string {
  const action = source === "workplace" ? ("workplaceChange" as const) : ("userAttach" as const);
  if (opts?.noteText != null) {
    return attachmentXmlCodec.encodeFileRef({ action, path: logicalPath, content: opts.noteText, display });
  }
  if (opts?.oversized === true) {
    return attachmentXmlCodec.encodeFileRef({
      action,
      path: logicalPath,
      content: OVERSIZED_ATTACH_NOTE,
      display: "filename",
    });
  }
  const lineBody = opts?.bodyIsRendered === true ? rawContent : renderFileBlockBody({ logicalPath, display, content: rawContent });
  return attachmentXmlCodec.encodeFileRef({ action, path: logicalPath, content: lineBody, display });
}

function isOversizedAttach(attachment: MessageAttachment, plainLength: number, budget: AttachBudget): boolean {
  if (attachment.source === "workplace") return false;
  if (isBinaryOrImageAttach(attachment)) return false;
  return !budget.tryConsume(plainLength);
}

/** attach 源 `filename` 档的正文占位文案；workplace 源保留目录规则的 `1|basename`。 */
function attachBinaryNote(attachment: MessageAttachment, status: WorkplaceDisplayStatus): string | undefined {
  if (attachment.source === "workplace") return undefined;
  return status === "filename" ? BINARY_ATTACH_NOTE : undefined;
}

/** 旧 `<file>` / `<dir>` 外壳只剥一层；返回内层正文与是否命中。 */
function unwrapLegacyBody(content: string, tag: "file" | "dir"): { body: string; wrapped: boolean } {
  const trimmed = content.trim();
  if (!trimmed.startsWith(`<${tag} `) || !trimmed.endsWith(`</${tag}>`)) return { body: trimmed, wrapped: false };
  const firstNl = trimmed.indexOf("\n");
  const lastNl = trimmed.lastIndexOf("\n");
  if (firstNl >= 0 && lastNl > firstNl) return { body: trimmed.slice(firstNl + 1, lastNl), wrapped: true };
  const body = trimmed.replace(new RegExp(`^<${tag}\\b[^>]*>\\s*`, "i"), "").replace(new RegExp(`\\s*</${tag}>\\s*$`, "i"), "");
  return { body, wrapped: true };
}

/** skillAttach 不存在提示行 XML（不写 seen：技能后续创建可自愈重附全文）。 */
function buildSkillAttachMissingXml(name: string): string {
  return buildUserVfsActionXml("skillAttach", { name, missing: true, note: SKILL_ATTACH_MISSING_NOTE });
}

/** 一轮 prepare 独占的附件 hydrate 状态。 */
export class AttachmentHydrator {
  private skillNames: Promise<Set<string>> | null = null;

  constructor(private readonly runtime: AttachmentHydratorRuntime, private readonly seen: Set<string>, private readonly workplaceSeen: Set<string>, private readonly budget: AttachBudget) {}

  /** 对单条非 hidden 用户输入消息做附件 hydrate 与 wrap。 */
  /** nm-style: keep-local — 单条消息管线，状态全部来自本对象。 */
  async hydrateMessage(message: ChatMessageData, isLatestUser: boolean): Promise<ChatMessageData> {
    if (message.hidden) return message;
    const effectiveExtraInfo = isLatestUser ? this.runtime.extraInfo : undefined;
    const attachments = message.attachments ?? [];
    const hasExtraInfo = typeof effectiveExtraInfo === "string" && effectiveExtraInfo.trim().length > 0;
    if (attachments.length === 0 && !hasExtraInfo) return message;

    const hydrated = [...attachments];
    // 单条内固定 attach → workplace；保持落库数组序，只改各自内容。
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i]!;
      if (attachment.source === "attach") hydrated[i] = await this.hydrateAttach(attachment);
    }
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i]!;
      if (attachment.source !== "workplace") continue;
      const rawPath = attachment.path;
      if (rawPath == null || rawPath === "") continue;
      const logicalPath = promptPathSeen.tryNormalize(rawPath);
      if (logicalPath == null) continue;
      if (this.seen.has(logicalPath) || this.workplaceSeen.has(logicalPath)) {
        hydrated[i] = { ...attachment, path: logicalPath, action: "workplaceChange", content: "" };
        continue;
      }
      this.seen.add(logicalPath);
      hydrated[i] = await this.hydrateFileFull({ ...attachment, path: logicalPath }, logicalPath);
    }

    const plainText = messageBodyTextFromBlocks(message.content.blocks);
    return {
      ...message,
      content: textBlocks(userMessageFormatter.wrapForLlm(plainText, hydrated, effectiveExtraInfo)),
      attachments: hydrated,
    };
  }

  /** attach 源：目录每次树；文本首次全文 / 其后短提示；image/binary 不套短提示仍计 seen。 */
  /** nm-style: keep-local — attach 分派阶段，分支共享本对象的 seen/budget。 */
  private async hydrateAttach(attachment: MessageAttachment): Promise<MessageAttachment> {
    if (attachment.action === "skillAttach") return this.hydrateSkill(attachment);
    const rawPath = attachment.path;
    if (rawPath == null || rawPath === "") return attachment;
    const logicalPath = promptPathSeen.tryNormalize(rawPath);
    if (logicalPath == null) return attachment;

    if (attachment.type === "dir") {
      let out: MessageAttachment;
      if (attachment.content != null) {
        if (attachment.content.includes("<action ")) {
          out = { ...attachment, path: logicalPath, action: attachment.action ?? "userAttach" };
        } else {
          const { body } = unwrapLegacyBody(attachment.content, "dir");
          out = {
            ...attachment,
            path: logicalPath,
            action: "userAttach",
            content: attachmentXmlCodec.encodeDirTree(logicalPath, body),
          };
        }
      } else {
        const treeRequest = {
          sessionId: this.runtime.sessionId,
          sessionKkv: this.runtime.sessionKkv,
          vfs: this.runtime.vfs,
        };
        const tree = await dirAttachTreeRenderer.render(logicalPath, treeRequest);
        out = {
          ...attachment,
          path: logicalPath,
          action: "userAttach",
          content: attachmentXmlCodec.encodeDirTree(logicalPath, tree),
        };
      }
      this.seen.add(logicalPath);
      return out;
    }

    const alreadySeen = this.seen.has(logicalPath);
    this.seen.add(logicalPath);
    if (isBinaryOrImageAttach(attachment)) return this.hydrateFileFull({ ...attachment, path: logicalPath }, logicalPath);
    if (alreadySeen) {
      return {
        ...attachment,
        path: logicalPath,
        action: "userAttach",
        content: buildUserVfsActionXml("userAttach", { path: logicalPath, alreadyReferenced: true }),
      };
    }
    return this.hydrateFileFull({ ...attachment, path: logicalPath }, logicalPath);
  }

  /** skillAttach：skill:{name} 命名空间 seen；首次全文 / 非首次短标记 / 缺失提示。 */
  /** nm-style: keep-local — skillAttach 管线，读盘与 seen/budget 同属本对象。 */
  private async hydrateSkill(attachment: MessageAttachment): Promise<MessageAttachment> {
    const name = attachment.skillName;
    if (typeof name !== "string" || name === "") return attachment;
    const key = attachmentScanner.skillKey(name);
    if (this.seen.has(key)) {
      return {
        ...attachment,
        action: "skillAttach",
        content: buildUserVfsActionXml("skillAttach", { name, alreadyReferenced: true }),
      };
    }
    if (this.runtime.skills == null || this.runtime.projectId == null) return attachment;
    const projectId = this.runtime.projectId;
    const skills = this.runtime.skills;
    this.skillNames ??= (async () => {
      try {
        return new Set((await skills.effectiveSkills(projectId)).map((skill) => skill.name));
      } catch {
        return new Set<string>();
      }
    })();
    const names = await this.skillNames;
    if (!names.has(name)) {
      return { ...attachment, action: "skillAttach", content: buildSkillAttachMissingXml(name) };
    }
    try {
      const file = await skills.readSkillFile(undefined, name, undefined, projectId);
      this.seen.add(key);
      const oversized = !this.budget.tryConsume(file.content.length);
      return {
        ...attachment,
        action: "skillAttach",
        content: buildUserVfsActionXml("skillAttach", {
          name,
          content: oversized ? OVERSIZED_ATTACH_NOTE : file.content,
          ...(oversized ? { display: "filename" as const } : {}),
        }),
      };
    } catch {
      return { ...attachment, action: "skillAttach", content: buildSkillAttachMissingXml(name) };
    }
  }

  /** 首次全文 hydrate（文本 / workplace / filename 档）→ action XML。 */
  private async hydrateFileFull(attachment: MessageAttachment, logicalPath: string): Promise<MessageAttachment> {
    const action = attachment.source === "workplace" ? ("workplaceChange" as const) : ("userAttach" as const);
    if (attachment.content != null) {
      if (attachment.content.includes("<action "))
        return {
          ...attachment,
          path: logicalPath,
          action: attachment.action ?? action,
        };
      const status = attachment.source === "workplace" ? await resolveWorkplaceStatus(logicalPath, this.runtime) : resolveAttachFileStatus(logicalPath, attachment.type);
      const { body: fileBody, wrapped: wasLegacyFile } = unwrapLegacyBody(attachment.content, "file");
      let plainLength = fileBody.length;
      if (wasLegacyFile) {
        plainLength = 0;
        for (const line of fileBody.split("\n")) plainLength += line.replace(/^\d+\|/, "").length;
      }
      const oversized = isOversizedAttach(attachment, plainLength, this.budget);
      const noteText = attachBinaryNote(attachment, status);
      const refOpts: FileRefActionOpts = wasLegacyFile ? { bodyIsRendered: true, oversized, noteText } : { oversized, noteText };
      const content = fileRefAction(attachment.source === "workplace" ? "workplace" : "attach", logicalPath, status, fileBody, refOpts);
      return { ...attachment, path: logicalPath, action, content };
    }

    const status = attachment.source === "workplace" ? await resolveWorkplaceStatus(logicalPath, this.runtime) : resolveAttachFileStatus(logicalPath, attachment.type);
    const cacheRequest = {
      sessionId: this.runtime.sessionId,
      sessionKkv: this.runtime.sessionKkv,
      vfs: this.runtime.vfs,
      path: logicalPath,
      status,
    };
    const cached = await loadOrFillFileCache(cacheRequest);
    const noteText = attachBinaryNote(attachment, status);
    const refOpts: FileRefActionOpts = {
      oversized: isOversizedAttach(attachment, cached.body.length, this.budget),
      noteText,
    };
    return {
      ...attachment,
      path: logicalPath,
      action,
      content: fileRefAction(attachment.source === "workplace" ? "workplace" : "attach", logicalPath, status, cached.body, refOpts),
    };
  }
}
