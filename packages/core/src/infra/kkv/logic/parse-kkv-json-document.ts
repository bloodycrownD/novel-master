/**
 * KKV 存储 JSON 文档解析与 decode 单源入口。
 *
 * @module infra/kkv/logic/parse-kkv-json-document
 */

/**
 * 解析 KKV 原始 JSON 字符串并 decode 为领域类型。
 *
 * @param raw - KKV 中读取的 JSON 字符串
 * @param decodeFn - 将 `JSON.parse` 结果 decode 为领域对象的函数
 * @returns decode 后的领域对象
 * @throws 由 `JSON.parse` 或 `decodeFn` 抛出的错误（调用方映射为模块专属错误）
 */
export function parseKkvJsonDocument<T>(
  raw: string,
  decodeFn: (parsed: unknown) => T,
): T {
  const parsed = JSON.parse(raw) as unknown;
  return decodeFn(parsed);
}
