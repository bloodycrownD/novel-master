/**
 * CLI 的 core 文案 translator（spec G4.6 的内嵌数据变体）。
 *
 * catalog 取 core 构建期内嵌模块（YAML 唯一真源生成），同步可用、不读盘。
 * 本轮固定 zh-CN（G6 再做运行时切换）。
 *
 * @module i18n
 */

import { CORE_CATALOGS, createTranslator, type MessageLike } from "@novel-master/core/i18n";

/** core descriptor → 中文 string（未知 key 原样回显）；string 直通。 */
export const coreT = createTranslator(CORE_CATALOGS, "zh-CN") as (message: MessageLike) => string;
