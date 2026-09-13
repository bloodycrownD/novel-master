/**
 * VFS 条目名（文件/目录名）校验。
 *
 * 拍板规则（不可照搬 POSIX 便携集，中文文件名是核心场景）：
 * - **拒绝**：C0/C1 控制字符（含 \n \r \t）与 NUL、纯空白名、首尾空格、`.` 与 `..`；
 * - **放行**：其余全部——中文、中间空格、括号、标点、emoji、全角字符等；
 * - `/` 由路径层天然处理（文件名语境不含）。
 *
 * @module domain/vfs/logic/validate-entry-name
 */

import { vfsInvalidName } from "@/errors/vfs-errors.js";

/** {@link validateVfsEntryName} 的返回形态。 */
export type VfsEntryNameValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** C0（U+0000–U+001F，含 \n \r \t）、DEL（U+007F）与 C1（U+0080–U+009F）控制字符。 */
// 校验目的就是拒绝控制字符，正则必须字面包含它们
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * 校验单个 VFS 条目名（不含 `/` 的路径末段）。
 *
 * @remarks
 * 只拦「用户/agent 显式创建与重命名」的入口；导入链路（zip/角色卡）不走本校验
 * （外部文件名可先导入再用改名功能纠正）。存量条目的读取与内容更新不受影响。
 * `String.prototype.trim` 同时覆盖半角与全角空白（U+3000 等），纯空白与首尾空白
 * 判断均以它为准。
 */
export function validateVfsEntryName(
  name: string
): VfsEntryNameValidation {
  if (name === "." || name === "..") {
    return { ok: false, reason: "文件名不能为 . 或 .." };
  }
  if (name.trim() === "") {
    return { ok: false, reason: "文件名不能为空或纯空白" };
  }
  if (CONTROL_CHARS.test(name)) {
    return { ok: false, reason: "文件名不能包含换行或控制字符" };
  }
  if (name !== name.trim()) {
    return { ok: false, reason: "文件名不能以空格开头或结尾" };
  }
  return { ok: true };
}

/**
 * 取路径末段（文件名语境）；根路径与空段返回 "/"。
 *
 * @remarks 入参应是 normalizePath 之后的逻辑路径（末段不会是 `.` / `..`）。根路径
 * 交由各入口既有的 root 拦截（cannot mkdir/delete root 等），本校验对其放行。
 */
export function vfsEntryNameOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx === -1) {
    return path;
  }
  return path.slice(idx + 1) || "/";
}

/**
 * 创建/重命名入口的断言式校验：末段名不合法时抛 `INVALID_NAME` VfsError。
 *
 * 只在「新条目诞生」的时机调用（mkdir、write 创建分支、renamePath/renamePrefix
 * 的新路径）——存量条目的内容更新不重新审判名字（zip 导入的历史名可继续编辑）。
 */
export function assertValidVfsEntryName(normalizedPath: string): void {
  const name = vfsEntryNameOfPath(normalizedPath);
  const result = validateVfsEntryName(name);
  if (!result.ok) {
    throw vfsInvalidName(name, result.reason);
  }
}
