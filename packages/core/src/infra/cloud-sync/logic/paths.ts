/**
 * 云同步远端对象路径规范化与键名生成。
 *
 * 补 / 去尾斜杠的纯路径原语已收敛到 `common/path.ts` 的 `Path`（`ensureTrailingSlash` 与
 * `stripTrailingSlash` 语义相反，两者不可互替）。
 *
 * @module infra/cloud-sync/logic/paths
 */

import { Path } from "@/common/path.js";

/**
 * 远端对象键名生成。
 */
export const CloudSyncPaths = {
    /** 生成 status.json 对象键 */
    statusKey(prefix: string): string {
        return `${Path.ensureTrailingSlash(prefix)}status.json`;
    },

    /**
   * 生成快照对象键：`{prefix}snapshots/rev-{6位零填充}.nmbackup`
   */
    snapshotKey(prefix: string, rev: number): string {
        const revPart = String(rev).padStart(6, "0");
        return `${Path.ensureTrailingSlash(prefix)}snapshots/rev-${revPart}.nmbackup`;
    },
} as const;
