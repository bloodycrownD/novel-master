/**
 * Composer / 气泡状态 chip 文案（presentation）。
 *
 * @module presentation/chat/attachment-chip
 */

import {Text} from "@/common/text.js";
import type {MessageAttachment, MessageAttachmentAction} from "@/domain/chat/model/message-attachment.schema.js";
import {attachmentPath} from "@/domain/chat/logic/message/attachment-path.js";

/** 已知 action → 中文二字。 */
const STATUS_CHIP_ZH: Readonly<Record<MessageAttachmentAction, string>> = {
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
    skillAttach: "", // 不进状态 chip；chip 文案以附件 skillName 为准
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
    userAttach: ""
};

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
 * 状态 chip 文案操作族。
 */
export const AttachmentChip = {
    /**
     * 已知枚举 → `中文二字:` + path。
     * `userAttach` 返回空串（不进状态 chip）。
     */
    formatStatusLabel(action: MessageAttachmentAction, path: string): string {
        const zh = STATUS_CHIP_ZH[action];
        if (zh === "") {
            return "";
        }
        return `${zh}:${path}`;
    },

    /**
     * 从附件读 `action`/`path`（及 rename/move 的 `to`）生成 chip 文案。
     * 有 `action` 时直接走 {@link STATUS_CHIP_ZH}（action 自描述，不再靠 name hack）。
     * 无 `action` 时按降级规则（不做英文 /「规则 ·」/ emoji 兼容承诺）。
     */
    formatStatusLabelFromAttachment(a: Pick<MessageAttachment, "action" | "path" | "name" | "source" | "content">, options?: StatusChipLabelOptions): string {
        if (options?.attachPrefixed === true && a.source === "attach") {
            const path = a.path || a.name || "";
            return path.startsWith("@") ? path : `@${path}`;
        }
        if (a.action != null) {
            if (a.action === "userAttach") {
                return "";
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
            return AttachmentChip.formatStatusLabel(a.action, path);
        }

        // 无 action 降级 1：workplace → 规则:<path>
        if (a.source === "workplace") {
            const path = AttachmentChip.resolvePathOrName(a);
            return AttachmentChip.formatStatusLabel("workplaceChange", path);
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
                    const sep = "→";
                    const idx = suffix.indexOf(sep);
                    if (idx >= 0) {
                        const from = suffix.slice(0, idx);
                        const to = suffix.slice(idx + sep.length);
                        if (from !== "" && to !== "") {
                            return `${STATUS_CHIP_ZH[attachmentPath.actionBetween(from, to)]}:${to}`;
                        }
                    }
                    suffix = AttachmentChip.renameSuffixToPath(suffix);
                }
                return `${zh}:${suffix}`;
            }
        }

        // 降级 3：裸 path / name
        return AttachmentChip.resolvePathOrName(a);
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
        const from = typeof parsed.from === "string" ? parsed.from : typeof parsed.oldPath === "string" ? parsed.oldPath : "";
        const to = typeof parsed.to === "string" ? parsed.to : typeof parsed.newPath === "string" ? parsed.newPath : "";
        return {
            annotateText: userAnnotation !== "" ? userAnnotation : typeof parsed.originalText === "string" ? parsed.originalText : null,
            renameTo: from !== "" && to !== "" ? to : null,
        };
    },
} as const;
