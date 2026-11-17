/**
 * 字面 HTML 实体解码（RN 侧薄入口）。
 *
 * 实现单源在 `common/text.ts` 的 `Text.decodeHtmlEntities`。WebView 侧保留镜像
 * 副本 `src/web/shared/decode-entities.ts`：composer-input / chat-transcript 的
 * WebView 构建门禁（build-webview.mjs 门 B）对 core 模块按白名单逐条记账，不能
 * 自由引 core；两侧等价性由 `__tests__/decode-entities-parity.test.ts` 守护。
 */
import {Text, type DecodeHtmlEntitiesOptions} from '@novel-master/core/common';

/** `Text.decodeHtmlEntities` 的选项：`preserveAngleBrackets` 保留尖括号（sanitize 出口路径用）。 */
export type DecodeLiteralHtmlEntitiesOptions = DecodeHtmlEntitiesOptions;

/**
 * 解码字面 HTML 实体（可多轮，处理双重编码如 `&amp;quot;`）。
 *
 * 纯转手，直接绑定 core 的实现；入参比原先宽（非 string 会被 String 化），
 * 调用方已保证 string 时行为不变。
 */
export const decodeLiteralHtmlEntities = Text.decodeHtmlEntities;

/** Markdown 入口：完整解码实体（含尖括号），供 markdown-it 解析。 */
// nm-style: keep-public — markdown 入口契约（与 web/shared/decode-entities 镜像对齐）
export const decodeForMarkdownInput = Text.decodeHtmlEntities;

/**
 * sanitize 出口：仍修复 quot/amp 双重编码，但保留 `&lt;` / `&gt;`，
 * 使 TrustedHtml 以实体形式展示用户可见尖括号。
 */
export function decodeAfterSanitize(text: string): string {
  return Text.decodeHtmlEntities(text, {preserveAngleBrackets: true});
}
