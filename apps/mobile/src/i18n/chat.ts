/**
 * Mobile 侧 chat 文案入口；catalog 走 core 构建期内嵌 TS（YAML 唯一真源经 gen-i18n-catalog.mjs 生成）。
 */
import { CHAT_CATALOGS } from '@novel-master/core/i18n/catalog/chat';
import { createTranslator } from '@novel-master/core/common';

/** Mobile 侧 chat 文案 translator；locale 决定权留给后续设置层。 */
export const chatTranslator = createTranslator(CHAT_CATALOGS, 'zh-CN');
