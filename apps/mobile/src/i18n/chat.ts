import enUS from '@novel-master/core/locales/chat.en-US.json';
import zhCN from '@novel-master/core/locales/chat.zh-CN.json';
import {createTranslator, type MessageCatalog} from '@novel-master/core/common';
import type {ChatMessageKey} from '@novel-master/core/chat';

const catalogs = {
  'zh-CN': zhCN as MessageCatalog<ChatMessageKey>,
  'en-US': enUS as MessageCatalog<ChatMessageKey>,
};

/** Mobile 侧 chat 文案入口；locale 决定权留给后续设置层。 */
export const chatTranslator = createTranslator(catalogs, 'zh-CN');
