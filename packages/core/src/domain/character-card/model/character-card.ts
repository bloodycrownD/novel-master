/**
 * 角色卡领域类型。
 *
 * @module domain/character-card/model/character-card
 */

/**
 * 相对目标目录的 Markdown 文件树。
 * key：无 leading `/`，段分隔为 `/`。
 */
export type MdTree = ReadonlyMap<string, string>;

/** 规范化后的角色卡数据字段（V2 / 扁平兼容）。 */
export type NormalizedCharacterCardData = {
  readonly description: string;
  readonly firstMes: string;
  readonly alternateGreetings: readonly string[];
  readonly characterBookEntries: readonly unknown[];
};
