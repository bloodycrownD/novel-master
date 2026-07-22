/**
 * Composer / 气泡状态 chip 中文二字映射（单点真源）。
 *
 * @module domain/chat/logic/status-chip-label
 */

import type {
  MessageAttachment,
  MessageAttachmentAction,
} from "../model/message-attachment.schema.js";

/** 已知 action → 中文二字。 */
export const STATUS_CHIP_ZH: Readonly<
  Record<MessageAttachmentAction, string>
> = {
  delete: "删除",
  write: "创建",
  edit: "编辑",
  mkdir: "创建",
  rename: "重命",
  workplaceChange: "规则",
  userAttach: "", // 不进状态 chip；映射表仍保留
  annotate: "批注",
};

const LEGACY_ACTION_PREFIX_RE = /^(\w+):(.*)$/;

/** 旧英文 action 前缀 → 中文二字（无 `action` 字段降级用）。 */
const LEGACY_PREFIX_ZH: Readonly<Record<string, string>> = {
  write: "创建",
  edit: "编辑",
  delete: "删除",
  mkdir: "创建",
  rename: "重命",
  workplaceChange: "规则",
  annotate: "批注",
  userAttach: "",
};

/**
 * 已知枚举 → `中文二字:` + path。
 * `userAttach` 返回空串（不进状态 chip）。
 */
export function formatStatusChipLabel(
  action: MessageAttachmentAction,
  path: string,
): string {
  const zh = STATUS_CHIP_ZH[action];
  if (zh === "") {
    return "";
  }
  return `${zh}:${path}`;
}

/**
 * 从附件读 `action`/`path`（及 rename 的 `to`）生成 chip 文案。
 * 无 `action` 时按降级规则（不做英文 /「规则 ·」/ emoji 兼容承诺）。
 */
export function formatStatusChipLabelFromAttachment(
  a: Pick<MessageAttachment, "action" | "path" | "name" | "source" | "content">,
): string {
  if (a.action != null) {
    if (a.action === "userAttach") {
      return "";
    }
    const path = resolveChipPath(a);
    return formatStatusChipLabel(a.action, path);
  }

  // 无 action 降级 1：workplace → 规则:<path>
  if (a.source === "workplace") {
    const path = resolvePathOrName(a);
    return formatStatusChipLabel("workplaceChange", path);
  }

  // 无 action 降级 2：旧 name 为 `write:/…` 等
  const raw = (a.name ?? "").trim();
  const m = LEGACY_ACTION_PREFIX_RE.exec(raw);
  if (m != null) {
    const prefix = m[1]!;
    let suffix = m[2] ?? "";
    const zh = LEGACY_PREFIX_ZH[prefix];
    if (zh != null && zh !== "") {
      if (prefix === "rename") {
        suffix = renameSuffixToChipPath(suffix);
      }
      return `${zh}:${suffix}`;
    }
  }

  // 降级 3：裸 path / name
  return resolvePathOrName(a);
}

function resolveChipPath(
  a: Pick<MessageAttachment, "action" | "path" | "name" | "content">,
): string {
  if (a.action === "rename") {
    // 优先 path（落库已取 to）；否则从 content JSON / name 解析
    if (a.path != null && a.path !== "") {
      return a.path;
    }
    const fromContent = tryParseRenameTo(a.content);
    if (fromContent != null) {
      return fromContent;
    }
    const fromName = renameSuffixToChipPath(
      stripLegacyPrefix(a.name ?? "") ?? a.name ?? "",
    );
    return fromName;
  }
  return resolvePathOrName(a);
}

function resolvePathOrName(
  a: Pick<MessageAttachment, "path" | "name">,
): string {
  if (a.path != null && a.path !== "") {
    return a.path;
  }
  const stripped = stripLegacyPrefix(a.name ?? "");
  if (stripped != null) {
    return stripped;
  }
  return a.name ?? "";
}

/** `rename:from→to` 后缀：含 `→` 取右侧。 */
function renameSuffixToChipPath(suffix: string): string {
  const sep = "→";
  const idx = suffix.indexOf(sep);
  if (idx >= 0) {
    return suffix.slice(idx + sep.length);
  }
  return suffix;
}

function stripLegacyPrefix(name: string): string | null {
  const m = LEGACY_ACTION_PREFIX_RE.exec(name.trim());
  if (m == null) {
    return null;
  }
  return m[2] ?? "";
}

function tryParseRenameTo(content: string | null | undefined): string | null {
  if (content == null || content === "") {
    return null;
  }
  const jsonMatch = /\{[\s\S]*\}/.exec(content);
  if (jsonMatch == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { to?: unknown };
    if (typeof parsed.to === "string" && parsed.to !== "") {
      return parsed.to;
    }
  } catch {
    return null;
  }
  return null;
}
