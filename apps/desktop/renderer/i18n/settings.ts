/** Renderer 侧 settings 文案入口；catalog 与 createTranslator 都经 shared/logic 再导出（不得直连 core）。 */
import { createTranslator, SETTINGS_CATALOGS } from "@shared/logic/settings-i18n";

/** settings 文案 translator；locale 决定权留给后续设置层。 */
export const settingsTranslator = createTranslator(SETTINGS_CATALOGS, "zh-CN");
