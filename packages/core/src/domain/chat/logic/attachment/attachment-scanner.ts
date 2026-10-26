/**
 * 发送时附件扫描与合并（`@path` / `$技能名`）。
 *
 * 领域服务：正文文本 → `MessageAttachment` 值对象；不依赖 UI。
 *
 * @module domain/chat/logic/attachment/attachment-scanner
 */

import { isBinaryFilePath, isImageFilePath } from "@/common/file.js";
import { SKILL_NAME_PATTERN } from "@/domain/skills/model/skill-name.js";
import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { attachmentStorageName, type MessageAttachment } from "../../model/message-attachment.schema.js";
import { promptPathSeen } from "./prompt-path-seen.js";

const AT_PATH_TOKEN_RE = /@([^\s@]+)/g;
const SKILL_TOKEN_RE = /(?<!\S)\$([^\s$/@]+)/g;

type ChatLogicError = AppError<"CHAT_INVALID_ARGUMENT">;

/**
 * 旧附件路径参数错误类。
 *
 * `fromPaths` 已不再抛出它：失败改为 `Result<..., AppError<"CHAT_INVALID_ARGUMENT">>`。
 * 类保留给 `public/chat.ts` 的既有导出契约（allowlist 快照），phase 2 随旧 API 删除。
 * nm-style: keep-public — 三端 public 契约，domain 内零抛出。
 */
export class AttachmentPathArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathArgumentError";
  }
}

/** 附件领域服务：扫描、物化、按 path/skillName 去重。 */
class AttachmentScanner {
  /** 从正文扫描 `@path` token，生成 `source:attach` 附件（按规范化 seen key 去重）。 */
  scanAtPaths(text: string): MessageAttachment[] {
    if (text === "") {
      return [];
    }
    const seen = new Set<string>();
    const out: MessageAttachment[] = [];
    AT_PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AT_PATH_TOKEN_RE.exec(text)) != null) {
      const raw = match[1]!;
      if (raw === "") {
        continue;
      }
      const seenKey = promptPathSeen.tryNormalize(raw);
      if (seenKey == null || seen.has(seenKey)) {
        continue;
      }
      seen.add(seenKey);
      out.push(attachFromPath(raw, seenKey));
    }
    return out;
  }

  /** 技能 seen / 去重 key。 */
  skillKey(name: string): string {
    return `skill:${name}`;
  }

  /** 从正文扫描 `$技能名` token，生成 skillAttach 附件（按 skillName 去重）。 */
  scanSkills(text: string): MessageAttachment[] {
    if (text === "") {
      return [];
    }
    const seen = new Set<string>();
    const out: MessageAttachment[] = [];
    SKILL_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SKILL_TOKEN_RE.exec(text)) != null) {
      const name = match[1]!;
      if (!SKILL_NAME_PATTERN.test(name)) {
        continue;
      }
      const key = this.skillKey(name);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        name,
        source: "attach",
        type: "text",
        content: null,
        skillName: name,
        action: "skillAttach",
      });
    }
    return out;
  }

  /** nm-style: keep-public — run-agent-turn 发送编排的统一合并入口；测试锁顺序。 */
  mergeScannedAtPaths(text: string, existing: readonly MessageAttachment[]): MessageAttachment[] {
    return this.mergeByPath(existing, this.scanAtPaths(text));
  }

  /** nm-style: keep-public — run-agent-turn 发送编排的统一合并入口；测试锁顺序。 */
  mergeScannedSkills(text: string, existing: readonly MessageAttachment[]): MessageAttachment[] {
    return this.mergeByPath(existing, this.scanSkills(text));
  }

  /** 按 path（或 user_ops name / skillName）去重合并；已有优先。 */
  mergeByPath(existing: readonly MessageAttachment[], incoming: readonly MessageAttachment[]): MessageAttachment[] {
    const out = [...existing];
    const seen = new Set(existing.map((a) => attachmentDedupeKey(a)).filter((k): k is string => k != null));
    for (const item of incoming) {
      const key = attachmentDedupeKey(item);
      if (key != null && seen.has(key)) {
        continue;
      }
      if (key != null) {
        seen.add(key);
      }
      out.push(item);
    }
    return out;
  }

  /** nm-style: keep-public — task 工具 fileAttachment 单点入口；失败以 CHAT_INVALID_ARGUMENT 返回。 */
  fromPaths(paths: readonly string[]): Result<MessageAttachment[], ChatLogicError> {
    const materialized: MessageAttachment[] = [];
    for (const raw of paths) {
      if (typeof raw !== "string" || raw.trim() === "") {
        return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "附件路径不能为空串或纯空白", { path: raw }));
      }
      let seenKey: string;
      try {
        seenKey = resolveLogicalPath(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Result.err(new AppError("CHAT_INVALID_ARGUMENT", message, { path: raw }));
      }
      const base = attachFromPath(raw, seenKey);
      materialized.push({
        ...base,
        name: attachmentStorageName(base.path),
        action: "userAttach",
      });
    }
    return Result.ok(this.mergeByPath([], materialized));
  }
}

export const attachmentScanner = new AttachmentScanner();

function attachmentDedupeKey(a: MessageAttachment): string | null {
  if (a.action === "skillAttach") {
    return typeof a.skillName === "string" && a.skillName !== "" ? attachmentScanner.skillKey(a.skillName) : null;
  }
  if (a.path != null && a.path !== "") {
    const seenKey = promptPathSeen.tryNormalize(a.path);
    return `path:${seenKey ?? a.path}`;
  }
  if (a.source === "user_ops") {
    return `user_ops:${a.name}`;
  }
  return null;
}

function attachFromPath(rawPath: string, seenKey: string): MessageAttachment {
  const isDir = promptPathSeen.isDirToken(rawPath);
  const storePath = isDir && seenKey !== "/" ? `${seenKey}/` : seenKey;
  const basename = seenKey.split("/").filter(Boolean).pop() ?? seenKey;
  if (isImageFilePath(seenKey) || isImageFilePath(rawPath)) {
    return { name: basename, source: "attach", type: "image", content: null, path: storePath };
  }
  if (isDir) {
    return { name: basename || storePath, source: "attach", type: "dir", content: null, path: storePath };
  }
  if (isBinaryFilePath(seenKey) || isBinaryFilePath(rawPath)) {
    return { name: basename, source: "attach", type: "text", content: null, path: storePath };
  }
  return { name: basename, source: "attach", type: "text", content: null, path: storePath };
}
