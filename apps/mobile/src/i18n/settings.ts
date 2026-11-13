import enUS from '@novel-master/core/locales/settings.en-US.json';
import zhCN from '@novel-master/core/locales/settings.zh-CN.json';
import {createTranslator, type MessageCatalog} from '@novel-master/core/common';
import type {SettingsMessageKey} from '@novel-master/core/settings';

const catalogs = {
  'zh-CN': zhCN as MessageCatalog<SettingsMessageKey>,
  'en-US': enUS as MessageCatalog<SettingsMessageKey>,
};

/** Mobile 侧 settings 文案入口；locale 决定权留给后续设置层。 */
export const settingsTranslator = createTranslator(catalogs, 'zh-CN');
