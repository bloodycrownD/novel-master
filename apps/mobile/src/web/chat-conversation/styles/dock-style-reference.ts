/**
 * dock 视觉参照常量（chat-webview-unify Step 6 顺手项 · RN 参照真源固化）。
 *
 * **为什么在本轮固化**：`ChatComposer.tsx` 是本迭代 Step 7 的删除对象，其
 * `styles`（box / dock / hintRow / error / sendBtn）是合成包 CSS 里 dock 段的
 * 数值出处。文件一删，数值出处随之消失，UI 一致性硬验收（逐屏截图对比）就失去
 * 可对照的 RN 真源。故在删除前把数值**逐项手抄**到本文件，并保留出处锚点注释。
 *
 * 语义分工（勿混）：
 * - 本文件 = **RN 参照真源**，供 `composer-dock-padding.test.ts` 一类 RN 侧断言
 *   与真机截图对比时对照；值本身由 `ChatComposer.tsx:713-762` 原样搬来。
 * - `src/web/chat-conversation/styles/chat-conversation.css` 的 `.composer-dock`
 *   / `.composer-dock__box` / `.hint-row` / `.error` / `.toolbar__send` 是**实际生效**
 *   的一套；两者相等由 Step 9/10 的样式相等断言锁。
 * - `composerToolBtnStyle` 直接 re-export 共享常量（36 圆钮 + hairline 描边）——
 *   它本身已是纯常量文件，不随 `ChatComposer` 删除而消失，re-export 只是让参照面
 *   聚在一处、避免日后各抄一份。
 *
 * 本文件**不进 bundle**（未被任何 entry import），只是 RN/web 双侧的数值对照表。
 */
import {StyleSheet} from 'react-native';
import {composerToolBtnStyle} from '@/components/chat/composer-toolbar-style';

/** 引用类工具按钮（⛶ / @ / $）：36 见方圆钮 + hairline 描边 + 内容居中。 */
export {composerToolBtnStyle};

/**
 * dock 容器（出处 `ChatComposer.tsx:714-720` `styles.dock`）。
 *
 * `backgroundColor` 不在此声明——现网由 `tokens.background` 在渲染处注入
 * （`<Animated.View style={[styles.dock, {backgroundColor: tokens.background}]}>`），
 * web 侧同样是 `.composer-dock { background: var(--bg) }`，**实底**不可省。
 */
export const composerDockStyle = {
  flexShrink: 0,
  paddingHorizontal: 12,
  paddingTop: 4,
  paddingBottom: 8,
} as const;

/**
 * 输入框视觉盒（出处 `ChatComposer.tsx:728-734` `styles.box`）。
 * `backgroundColor` / `borderColor` 同理由 tokens 注入（surface / border）。
 */
export const composerBoxStyle = {
  borderWidth: StyleSheet.hairlineWidth,
  borderRadius: 12,
  paddingHorizontal: 8,
  paddingTop: 4,
  paddingBottom: 6,
} as const;

/** 无模型提示行（出处 `ChatComposer.tsx:721-723` `styles.hintRow`）。 */
export const composerHintRowStyle = {
  marginBottom: 6,
} as const;

/** 报错文本行（出处 `ChatComposer.tsx:724-727` `styles.error`；文字色取 tokens.danger）。 */
export const composerErrorStyle = {
  marginBottom: 6,
  fontSize: 13,
} as const;

/** 发送/终止钮（出处 `ChatComposer.tsx:755-761` `styles.sendBtn`）。 */
export const composerSendBtnStyle = {
  width: 40,
  height: 40,
  borderRadius: 20,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

/**
 * toolbar 行（出处 `ChatComposer.tsx:746-754` `styles.toolbar` + `styles.toolbarSpacer`）。
 * `gap: 8` 与 `spacer flex: 1` 同属 toolbar 的排布口径，一并留档。
 */
export const composerToolbarStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 4,
  gap: 8,
} as const;

export const composerToolbarSpacerStyle = {
  flex: 1,
} as const;

/**
 * `input` 的 metrics 口径（出处 `ChatComposer.tsx:735-745` `styles.input`）。
 * 与 `CONVERSATION_COMPOSER_METRICS`（Step 4 已迁入 web model）同值——这里留的是
 * RN 侧的**出处快照**，两处相等由 T-CU10 / T-FS1 断言锁。
 */
export const composerInputStyleSnapshot = {
  minHeight: 56,
  /** 5 行封顶（12 + 22×5）；原 160 是老 RN 输入框沿用值，偏高压屏。 */
  maxHeight: 122,
  fontSize: 16,
  lineHeight: 22,
  paddingHorizontal: 4,
  paddingVertical: 6,
} as const;
