/** Renderer 侧 chat 文案入口；catalog 与 createTranslator 都经 shared/logic 再导出（不得直连 core）。 */
import {
  chatEnUSCatalogs,
  chatZhCNCatalogs,
  createTranslator,
  type ChatMessageKey,
  type MessageCatalog,
} from "@shared/logic/chat-i18n";

const catalogs = {
  "zh-CN": chatZhCNCatalogs as MessageCatalog<ChatMessageKey>,
  "en-US": chatEnUSCatalogs as MessageCatalog<ChatMessageKey>,
};

/** chat 文案 translator；locale 决定权留给后续设置层。 */
export const chatTranslator = createTranslator(catalogs, "zh-CN");
