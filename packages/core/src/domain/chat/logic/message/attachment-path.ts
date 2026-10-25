/**
 * 附件路径语义：逻辑父目录与 rename/move 分类。
 *
 * @module domain/chat/logic/message/attachment-path
 */

/** 附件路径语义命名空间（无实例状态，不需要 class）。 */
export const attachmentPath = {
    /** 逻辑父目录。 */
    parentOf(path: string): string {
        const normalized = path.trim();
        if (normalized === "" || normalized === "/") {
            return "/";
        }
        const noTrail = normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
        const idx = noTrail.lastIndexOf("/");
        if (idx <= 0) {
            return "/";
        }
        return noTrail.slice(0, idx) || "/";
    },

    /** 同目录 → `rename`；跨目录 → `move`。 */
    actionBetween(from: string, to: string): "rename" | "move" {
        return this.parentOf(from) === this.parentOf(to) ? "rename" : "move";
    },
};
