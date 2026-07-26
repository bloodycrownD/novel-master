/**
 * revision 行与 GC 可达集共用的 path:version 键。
 *
 * @module domain/vfs/logic/revision-pair-key
 */

/** 构造 revision 行的稳定键（物理 path + version）。 */
export function revisionPairKey(path: string, version: number): string {
  return `${path}:${version}`;
}
