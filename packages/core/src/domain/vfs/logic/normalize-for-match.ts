/**
 * 替换匹配用的归一化纯函数（仅用于定位，不用于落盘）。
 *
 * 把引号族和全角空格归一化为「直引号 + 半角空格」基线，让 LLM 重建
 * `oldString` 时把弯引号写成日式引号、或把全角空格写成半角空格的
 * 情况也能命中。归一化只参与 `indexOf` 定位，实际切片和拼接都走原文，
 * 所以文件里没动过的引号不会被改写。
 *
 * @module domain/vfs/logic/normalize-for-match
 */

/**
 * v1 归一化映射表（全部为单字符 1:1 映射）。
 *
 * 因为每一项都是 BMP 内的单码点，代理对（emoji 等）原样透传不参与映射，
 * 所以归一化前后在码点层面和 UTF-16 码元层面都严格 1:1，
 * `normalizedContent.indexOf(...)` 拿到的码元 index 可以直接当作原文
 * 码元 index 用，不需要任何位置映射回查。
 *
 * 省略号（`……` vs `...`，N:1 映射）v1 不做，推迟到 v2——N:1 会改变长度，
 * 需要引入「原文→归一化字符位置映射数组」做 index 回查，复杂度跳一档。
 */
const QUOTE_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  // 弯引号 → 直引号
  ["\u2018", "'"], // ‘ LEFT SINGLE QUOTATION MARK
  ["\u2019", "'"], // ’ RIGHT SINGLE QUOTATION MARK
  ["\u201C", '"'], // “ LEFT DOUBLE QUOTATION MARK
  ["\u201D", '"'], // ” RIGHT DOUBLE QUOTATION MARK
  // 日式引号 → 直引号
  ["\u300C", '"'], // 「 LEFT CORNER BRACKET
  ["\u300D", '"'], // 」 RIGHT CORNER BRACKET
  ["\u300E", "'"], // 『 LEFT WHITE CORNER BRACKET
  ["\u300F", "'"], // 』 RIGHT WHITE CORNER BRACKET
  // 全角空格 → 半角空格
  ["\u3000", " "], // IDEOGRAPHIC SPACE
]);

/**
 * 对字符串做「引号族 + 全角空格」归一化，供替换匹配定位用。
 *
 * @remarks
 * 用 `Array.from` 按码点遍历，避免代理对在 UTF-16 码元层面被截断。
 * 归一化后仍是普通 JS `string`，后续 `indexOf`/`slice` 继续用原生
 * UTF-16 版本——因为 v1 全部映射字符都是 BMP 内单码点，代理对原样
 * 透传，UTF-16 码元层面也严格 1:1，index 可以直接通用。
 *
 * 落盘内容绝不能用归一化后的串——归一化只用于定位命中位置，
 * 切片和拼接必须走原文，否则未替换段的引号会被悄悄改写。
 */
export function normalizeForMatch(input: string): string {
  let result = "";
  for (const ch of Array.from(input)) {
    result += QUOTE_MAP.get(ch) ?? ch;
  }
  return result;
}
