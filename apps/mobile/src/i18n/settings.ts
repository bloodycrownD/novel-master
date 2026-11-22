/**
 * Mobile 侧 settings 文案入口；catalog 走 core 构建期内嵌 TS（YAML 唯一真源经 gen-i18n-catalog.mjs 生成）。
 */
import { SETTINGS_CATALOGS } from '@novel-master/core/i18n/catalog/settings';
import { createTranslator } from '@novel-master/core/common';

/** Mobile 侧 settings 文案 translator；locale 决定权留给后续设置层。 */
export const settingsTranslator = createTranslator(SETTINGS_CATALOGS, 'zh-CN');
