/**
 * revision 行与 GC 可达集共用的 entryId:version 键。
 *
 * @module domain/vfs/logic/revision-pair-key
 */

export const RevisionPairKey = {
  /** 构造 revision 行的稳定键（entryId + version）。 */
  build(entryId: number, version: number): string {
    return `${entryId}:${version}`;
  },
} as const;
