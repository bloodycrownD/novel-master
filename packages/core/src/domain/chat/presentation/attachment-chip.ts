/**
 * Composer / 气泡状态 chip 文案（domain/chat 展示层）。
 *
 * 只产出 descriptor（key + params），不包含文案、不依赖 locale；由 UI 用
 * core catalog + translator（desktop/mobile `coreT`、webview `uiText`）渲染。
 *
 * @module domain/chat/presentation/attachment-chip
 */

import {Text} from "@/common/text.js";
import type {MessageAttachment, MessageAttachmentAction} from "@/domain/chat/model/message-attachment.schema.js";
import {attachmentPath} from "@/domain/chat/logic/message/attachment-path.js";
import type {MessageDescriptor} from "@/common/i18n.js";
import {CHIP_ACTION_KEYS, CHIP_TEMPLATE_KEY, CHIP_BARE_KEY} from "./chip-keys.js";

/** chip descriptor（嵌套：action 位递归取二字词，模板 `{action}:{path}` 插值）。 */
export type AttachmentChipDescriptor = MessageDescriptor<typeof CHIP_TEMPLATE_KEY> | MessageDescriptor<typeof CHIP_BARE_KEY>;

/** 已知 action → chip action 词 key；null = 不进状态 chip（userAttach / skillAttach）。 */
function chipActionKey(action: MessageAttachmentAction): AttachmentChipDescriptor | null {
    const key = (CHIP_ACTION_KEYS as Record<string, `label.attachment.action.${string}` | undefined>)[action];
    if (key == null) {
        return null;
    }
    return {key: CHIP_TEMPLATE_KEY, params: {action: {key}, path: ""}};
}

const LEGACY_ACTION_PREFIX_RE = /^(\w+):(.*)$/;

/** 批注 chip 摘要最大字符数（防 mobile chip 超长）。 */
const ANNOTATE_CHIP_MAX_CHARS = 20;

/** chip 文案口径（三端单源 + 通道配置）。 */
export interface StatusChipLabelOptions {
    /**
     * `source === "attach"` 时输出 `@path`（WebView 附件行口径；RN 状态条不进 attach）。
     * 该短路优先于 action（webview 语义：attach 附件一律 `@路径`）。
     */
    readonly attachPrefixed?: boolean;
}

/**
 * 状态 chip 文案操作族（descriptor 出口；文案本体在 chat catalog）。
 */
export const AttachmentChip = {
    /**
     * 已知枚举 → chip descriptor（action 词 + `{action}:{path}` 模板）。
     * `userAttach` / `skillAttach` 返回 null（不进状态 chip）。
     */
    statusLabel(action: MessageAttachmentAction, path: string): AttachmentChipDescriptor | null {
        const base = chipActionKey(action);
        if (base == null) {
            return null;
        }
        return {key: base.key, params: {action: base.params!.action, path}};
    },

    /**
     * 从附件读 `action`/`path`（及 rename/move 的 `to`）生成 chip descriptor。
     * 有 `action` 时直接走 {@link chipActionKey}（action 自描述，不再靠 name hack）。
     * 无 `action` 时按降级规则（不做英文 /「规则 ·」/ emoji 兼容承诺）。
     */
    fromAttachment(a: Pick<MessageAttachment, "action" | "path" | "name" | "source" | "content">, options?: StatusChipLabelOptions): AttachmentChipDescriptor | null {
        if (options?.attachPrefixed === true && a.source === "attach") {
            const path = a.path || a.name || "";
            const ref = path.startsWith("@") ? path : `@${path}`;
            return {key: CHIP_BARE_KEY, params: {path: ref}};
        }
        if (a.action != null) {
            if (a.action === "userAttach") {
                return null;
            }
            let path: string;
            if (a.action === "annotate") {
                // 批注：chip 显示「用户批注内容」而非划词原文——优先 userAnnotation，回落 originalText（向后兼容老附件）。
                const parsed = AttachmentChip.parseContent(a.content);
                const chipText = parsed?.annotateText;
                path = chipText != null && chipText !== "" ? Text.truncate(chipText.replace(/[\r\n]+/g, " ").trim(), ANNOTATE_CHIP_MAX_CHARS) : AttachmentChip.resolvePathOrName(a);
            } else if (a.action === "rename" || a.action === "move") {
                // 优先 path（落库已取 to）；否则从 content JSON / name 解析。
                if (a.path != null && a.path !== "") {
                    path = a.path;
                } else {
                    const parsed = AttachmentChip.parseContent(a.content);
                    const to = parsed?.renameTo;
                    path = to ?? AttachmentChip.renameSuffixToPath(AttachmentChip.stripLegacyPrefix(a.name ?? "") ?? a.name ?? "");
                }
            } else {
                path = AttachmentChip.resolvePathOrName(a);
            }
            return AttachmentChip.statusLabel(a.action, path);
        }

        // 无 action 降级 1：workplace → 规则:<path>
        if (a.source === "workplace") {
            const path = AttachmentChip.resolvePathOrName(a);
            return AttachmentChip.statusLabel("workplaceChange", path);
        }

        // 无 action 降级 2：旧 name 为 `write:/…` 等（legacy 前缀名与 action 同名，复用同一张 key 表）
        const raw = (a.name ?? "").trim();
        const m = LEGACY_ACTION_PREFIX_RE.exec(raw);
        if (m != null) {
            const prefix = m[1]!;
            let suffix = m[2] ?? "";
            const legacy = chipActionKey(prefix as MessageAttachmentAction);
            if (legacy != null) {
                if (prefix === "rename" || prefix === "move") {
                    const sep = "→";
                    const idx = suffix.indexOf(sep);
                    if (idx >= 0) {
                        const from = suffix.slice(0, idx);
                        const to = suffix.slice(idx + sep.length);
                        if (from !== "" && to !== "") {
                            const derived = chipActionKey(attachmentPath.actionBetween(from, to));
                            if (derived != null) {
                                return {key: derived.key, params: {action: derived.params!.action, path: to}};
                            }
                        }
                    }
                    suffix = AttachmentChip.renameSuffixToPath(suffix);
                }
                return {key: legacy.key, params: {action: legacy.params!.action, path: suffix}};
            }
        }

        // 降级 3：裸 path / name（非翻译文案，`{path}` 直出）
        const bare = AttachmentChip.resolvePathOrName(a);
        return bare === "" ? null : {key: CHIP_BARE_KEY, params: {path: bare}};
    },

    resolvePathOrName(a: Pick<MessageAttachment, "path" | "name">): string {
        if (a.path != null && a.path !== "") {
            return a.path;
        }
        const stripped = AttachmentChip.stripLegacyPrefix(a.name ?? "");
        if (stripped != null) {
            return stripped;
        }
        return a.name ?? "";
    },

    /** `rename:from→to` / `move:from→to` 后缀：含 `→` 取右侧。 */
    renameSuffixToPath(suffix: string): string {
        const sep = "→";
        const idx = suffix.indexOf(sep);
        if (idx >= 0) {
            return suffix.slice(idx + sep.length);
        }
        return suffix;
    },

    stripLegacyPrefix(name: string): string | null {
        const m = LEGACY_ACTION_PREFIX_RE.exec(name.trim());
        if (m == null) {
            return null;
        }
        return m[2] ?? "";
    },

    /** 从 content 文本里抠出 chip 可用的批注/rename 字段；解析失败统一返回 null。 */
    parseContent(content: string | null | undefined): { annotateText: string | null; renameTo: string | null } | null {
        if (content == null || content === "") {
            return null;
        }
        const jsonMatch = /\{[\s\S]*\}/.exec(content);
        if (jsonMatch == null) {
            return null;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(jsonMatch[0]);
        } catch {
            return null;
        }
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
            return null;
        }
        const parsed = raw as { userAnnotation?: unknown; originalText?: unknown; from?: unknown; to?: unknown; oldPath?: unknown; newPath?: unknown };
        const userAnnotation = typeof parsed.userAnnotation === "string" ? parsed.userAnnotation.trim() : "";
        let from = "";
        if (typeof parsed.from === "string") {
            from = parsed.from;
        } else if (typeof parsed.oldPath === "string") {
            from = parsed.oldPath;
        }
        let to = "";
        if (typeof parsed.to === "string") {
            to = parsed.to;
        } else if (typeof parsed.newPath === "string") {
            to = parsed.newPath;
        }
        let annotateText: string | null = null;
        if (userAnnotation !== "") {
            annotateText = userAnnotation;
        } else if (typeof parsed.originalText === "string") {
            annotateText = parsed.originalText;
        }
        return {
            annotateText,
            renameTo: from !== "" && to !== "" ? to : null,
        };
    },
} as const;
