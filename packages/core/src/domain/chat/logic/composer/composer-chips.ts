/**
 * Composer 状态 chip 判定与拆分（T-X2-1 / T-ATD1 / T-AT1）。
 *
 * @module domain/chat/logic/composer/composer-chips
 */

/** Composer chip 投影命名空间（无实例状态）。 */
export const composerChips = {
    /** 拆成状态 / attach（attach 仅兼容旧数据过滤，UI 不再渲染）。 */
    partition<T extends { readonly source: string; readonly action?: string }>(attachments: readonly T[]): { readonly status: T[]; readonly attach: T[] } {
        const status: T[] = [];
        const attach: T[] = [];
        for (const a of attachments) {
            const isStatus = a.action !== "userAttach" && a.source !== "attach" && (a.source === "workplace" || (a.source === "user_ops" && a.action === "annotate"));
            if (isStatus) {
                status.push(a);
            } else if (a.source === "attach") {
                attach.push(a);
            }
        }
        return {status, attach};
    }
};
