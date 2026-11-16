/**
 * VFS 域守卫与 edit REPLACE_NOT_FOUND 的 LCS 诊断字段类型。
 *
 * `VfsError` / `VfsZipError` 类与旧字符串短码联合已退役，构造统一
 * `new AppError("VFS_*", params)`；legacy 手搓形态的唯一生产者
 * `service/vfs/impl/legacy-vfs-error` mapper 已随三期 Step 6 删除，legacy
 * 分支一并撤除（总纲 §7.2-3）。本文件保留两样：
 * - {@link VfsReplaceNotFoundDetails}：edit REPLACE_NOT_FOUND 的 LCS 诊断字段类型。
 * - {@link isVfsError} 域守卫：guards 统一后是 {@link inDomain} 的一行组合，
 *   AppError 且数字码落在 VFS 域段（码表登记的 102 VFS 段含 VFS_ZIP_* /
 *   VFS_CONTENT_* / VFS_SINGLE_FILE_*，103 VFS_CHARACTER_CARD 段），沿 cause
 *   链回溯。域判定按段号而非 key 命名约定——语义属 VFS、前缀不同的 key
 *   不会静默漏判。
 *
 * @module errors/vfs-errors
 */

import { inDomain, type AppErrorGuard } from "@/errors/guards.js";

/**
 * edit REPLACE_NOT_FOUND 时的 LCS 诊断字段。
 *
 * oldStringPreview / fileHintPreview 是双方前 100 字符的**原始文本**预览，
 * 由 formatter 以 JSON 转义形态展示——中文引号、HTML entity、换行/制表
 * 这类「肉眼看着一样或看不见」的差异会直接显形（`“` vs `"` vs `&ldquo;`、
 * `\n`/`\t`），且 LLM 可直接照抄修正 oldString（hex 码点无法反向消费，已退役）。
 * 设为可选，老的对象字面量构造路径不强制要求。
 */
export type VfsReplaceNotFoundDetails = {
  readonly oldStringLength: number;
  readonly longestCommonSubstring: string;
  readonly lcsLength: number;
  readonly lcsOccurrences: number;
  readonly oldStringPreview?: string;
  readonly fileHintPreview?: string;
};

/**
 * 结构守卫：AppError 且 `code` 落在 VFS 域段（102000-103999），沿 cause 链回溯。
 *
 * nm-style: keep-public — VFS 域策略入口（inDomain 的 VFS 段位组合），service 多处
 * 生产调用 + 域测试直接引用；内联会把段位策略散到各调用点，不能撤导出。
 */
export const isVfsError: AppErrorGuard = (e) => inDomain(e, "VFS", "VFS_CHARACTER_CARD");
