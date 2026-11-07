/**
 * Desktop 的 core 文案 translator（spec G4.1/G4.2）。
 *
 * catalog 经 core 的构建期内嵌模块（`@novel-master/core/i18n` 的 `CORE_CATALOGS`，
 * 由 YAML 唯一真源生成）同步可用——main 与 renderer（shared 层）都不读盘、
 * 不依赖 IPC 时序。本轮固定 zh-CN（localeRule：默认 locale，切换归 G6）。
 *
 * @module shared/logic/core-i18n
 */

import { CORE_CATALOGS, createTranslator, type MessageLike } from "@novel-master/core/i18n";

/** core descriptor → 中文 string（未知 key 原样回显）；string 直通。 */
export const coreT = createTranslator(CORE_CATALOGS, "zh-CN") as (message: MessageLike) => string;
