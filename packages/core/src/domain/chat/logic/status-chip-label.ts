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
  /** 同目录换名。 */
  rename: "改名",
  /** 跨目录移动。 */
  move: "移动",
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
  rename: "改名",
  move: "移动",
  workplaceChange: "规则",
  annotate: "批注",
  userAttach: "",
};

/** 逻辑父目录：`/a.md`→`/`，`/续写/a.md`→`/续写`。 */
export function logicalParentDir(path: string): string {
  const normalized = path.trim();
  if (normalized === "" || normalized === "/") {
    return "/";
  }
  const noTrail =
    normalized.length > 1 && normalized.endsWith("/")
      ? normalized.slice(0, -1)
      : normalized;
  const idx = noTrail.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return noTrail.slice(0, idx) || "/";
}

/**
 * 同目录 → `rename`；跨目录 → `move`（协议与 VFS `mv` 解耦分类）。
 */
export function resolveRenameOrMoveAction(
  from: string,
  to: string,
): "rename" | "move" {
  return logicalParentDir(from) === logicalParentDir(to) ? "rename" : "move";
}

/**
 * 旧无 action / 旧 `rename:from→to` 降级文案。
 * 缺 from/to 时回落 {@link STATUS_CHIP_ZH}.rename。
 */
export function renameChipZh(from: string, to: string): string {
  return STATUS_CHIP_ZH[resolveRenameOrMoveAction(from, to)];
}

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
 * 从附件读 `action`/`path`（及 rename/move 的 `to`）生成 chip 文案。
 * 有 `action` 时直接走 {@link STATUS_CHIP_ZH}（action 自描述，不再靠 name hack）。
 * 无 `action` 时按降级规则（不做英文 /「规则 ·」/ emoji 兼容承诺）。
 */
export function formatStatusChipLabelFromAttachment(
  a: Pick<MessageAttachment, "action" | "path" | "name" | "source" | "content">,
): string {
  if (a.action != null) {
    if (a.action === "userAttach") {
      return "";
    }
    return formatStatusChipLabel(a.action, resolveChipPath(a));
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
      if (prefix === "rename" || prefix === "move") {
        const pair = parseRenameArrowPair(suffix);
        if (pair != null) {
          return `${renameChipZh(pair.from, pair.to)}:${pair.to}`;
        }
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
  if (a.action === "rename" || a.action === "move") {
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

/** `rename:from→to` / `move:from→to` 后缀：含 `→` 取右侧。 */
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
  return tryParseRenamePairFromContent(content)?.to ?? null;
}

function tryParseRenamePairFromContent(
  content: string | null | undefined,
): { from: string; to: string } | null {
  if (content == null || content === "") {
    return null;
  }
  const jsonMatch = /\{[\s\S]*\}/.exec(content);
  if (jsonMatch == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      from?: unknown;
      to?: unknown;
      oldPath?: unknown;
      newPath?: unknown;
    };
    const from =
      typeof parsed.from === "string"
        ? parsed.from
        : typeof parsed.oldPath === "string"
          ? parsed.oldPath
          : "";
    const to =
      typeof parsed.to === "string"
        ? parsed.to
        : typeof parsed.newPath === "string"
          ? parsed.newPath
          : "";
    if (from !== "" && to !== "") {
      return { from, to };
    }
  } catch {
    return null;
  }
  return null;
}

/** `from→to` 或 `rename:from→to` 后缀。 */
function parseRenameArrowPair(
  suffix: string,
): { from: string; to: string } | null {
  const sep = "→";
  const idx = suffix.indexOf(sep);
  if (idx < 0) {
    return null;
  }
  const from = suffix.slice(0, idx);
  const to = suffix.slice(idx + sep.length);
  if (from === "" || to === "") {
    return null;
  }
  return { from, to };
}
