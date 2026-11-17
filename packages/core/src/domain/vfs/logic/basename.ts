/**
 * 逻辑路径末段（basename）单源：展示标题 / 排序回退键共用。
 *
 * 口径（三处旧副本的行为并集）：忽略尾部斜杠；root `/` → `/`（不是空串）；
 * 无斜杠的裸名原样返回。旧副本里 workplace 排序与文件编辑标题对 root 返回
 * 空串——那两处入参都是文件路径，root 不会出现，收敛后 root 语义统一为 `/`。
 *
 * @module domain/vfs/logic/basename
 */

export function basenameOf(path: string): string {
  if (path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
