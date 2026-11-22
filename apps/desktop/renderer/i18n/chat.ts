/** Renderer 侧 chat 文案入口；catalog 与 createTranslator 都经 shared/logic 再导出（不得直连 core）。 */
import {
  CHAT_CATALOGS,
  createTranslator,
} from "@shared/logic/chat-i18n";

/** chat 文案 translator；locale 决定权留给后续设置层。 */
export const chatTranslator = createTranslator(CHAT_CATALOGS, "zh-CN");
