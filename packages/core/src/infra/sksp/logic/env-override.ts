/**
 * SKSP env 覆盖判定：三端共用的纯函数。
 *
 * 把"env 是否生效"这层语义收敛到一处，避免 desktop/mobile/cli 各自重写判定
 * 导致空串、空白、undefined 的处理漂移。
 *
 * 语义：env 值为 undefined / 空串 / 仅空白 → 返回 null（视为不覆盖 DB）；
 *      否则返回 env 值本身。
 *
 * @module infra/sksp/logic/env-override
 */

/**
 * 解析某个环境变量是否构成对 DB 的有效覆盖。
 *
 * @param name 环境变量名（通常是 refToEnvVar 的返回值，调用方负责校验）。
 * @param env  环境变量字典；调用方显式注入，便于测试与 RN/CLI 自定义来源。
 * @returns 非空 env 值；若未设置或仅空白则返回 null。
 */
export function resolveSkspEnvOverride(
  name: string,
  env: Record<string, string | undefined>,
): string | null {
  const v = env[name];
  // undefined / 空串 / 仅空白 一律视为不覆盖 DB
  if (v === undefined || v === "" || v.trim() === "") {
    return null;
  }
  return v;
}
