/**
 * 富文本实体解码的 sanitize 出口（RN 侧）。
 *
 * 默认解码（含尖括号）不在这里转手：唯一实现在 `common/text.ts` 的
 * `Text.decodeHtmlEntities`，调用点直引。WebView 侧保留镜像副本
 * `src/web/shared/decode-entities.ts`：composer-input / chat-transcript 的
 * WebView 构建门禁（build-webview.mjs 门 B）对 core 模块按白名单逐条记账，
 * 不能自由引 core；两侧等价性由 `__tests__/decode-entities-parity.test.ts` 守护。
 */
import {Text} from '@novel-master/core/common';

/**
 * sanitize 出口：仍修复 quot/amp 双重编码，但保留 `&lt;` / `&gt;`，
 * 使 TrustedHtml 以实体形式展示用户可见尖括号。
 */
export function decodeAfterSanitize(text: string): string {
  return Text.decodeHtmlEntities(text, {preserveAngleBrackets: true});
}
