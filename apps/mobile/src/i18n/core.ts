/**
 * Mobile 的 core 文案 translator（spec G4.4 的内嵌数据变体）。
 *
 * catalog 取 core 的构建期内嵌模块（YAML 唯一真源经 scripts/gen-i18n-catalog.mjs
 * 生成），启动同步可用、不读盘、不改启动序列。本轮固定 zh-CN（G6 再做切换）。
 *
 * @module i18n/core
 */

import { CORE_CATALOGS, createTranslator, type MessageLike } from "@novel-master/core/i18n";

/** core descriptor → 中文 string（未知 key 原样回显）；string 直通。 */
export const coreT = createTranslator(CORE_CATALOGS, "zh-CN") as (message: MessageLike) => string;
