/**
 * dock 视觉参照面 · RN 侧新址（composer-native-2026-10 Step 2 · 变更点 #9 前半）。
 *
 * **来历**：数值原在 `src/web/chat-conversation/styles/dock-style-reference.ts`
 * （chat-webview-unify Step 6 起、cr1-P1-5 瘦身后）。composer-native 迭代要把
 * dock 语义迁回 RN（Step 3/4 的 `NativeChatComposer`），参照面随之搬到 RN 侧
 * 本文件——内容与旧址**逐字同构**（原样保留），测试对旧址文件的引用同步改指
 * 这里（T-CU10 的「RN ⇄ dock-style.ts」形态）。旧址文件待 Step 6 随 chat-conversation
 * 包一并删除。
 *
 * **现状导出两处**，判据与旧址一致——**RN 真源今天是否还活着**：
 * - `composerToolBtnStyle` —— 共享常量文件 `composer-toolbar-style.ts` 仍在，本身是纯常量，
 *   re-export 只是让参照面聚在一处、避免日后各抄一份。
 * - `attachmentDraftChipsStyles` —— chips 段唯一幸存的 RN 真源（`AttachmentDraftChips.tsx`
 *   随 legacy 转录引擎退役后仍然在用），且它的 StyleSheet 就是 dock 段 chips 数值的出处。
 *
 * **职责边界**：数值对照表 + **Step 3/4 起的 RN 消费真源**——`NativeChatComposer` /
 * `token-ranges.ts` 的输入框尺寸与胶囊数值从这里的常量取（单源），不再各抄一份；
 * Step 4 的 dock 外围件（容器/hint/error/toolbar/typeahead 浮层）数值同样收进本表；
 * web 侧对照面仍由 `chat-conversation-boot-script.test.ts` 消费（旧址同款纪律）。
 */

/**
 * composer 输入框尺寸口径（composer-native-2026-10 Step 3 · D7 高度链）。
 *
 * 数值与 web 侧 `src/web/chat-conversation/webview/model.ts` 的
 * `CONVERSATION_COMPOSER_METRICS` **同构**（5 行封顶公式）：
 * `maxHeight = paddingV×2 + lineHeight×5 = 12 + 110 = 122`。
 * 两处不建 import 依赖（web 包 Step 6 退役，RN 侧常量只对照不引用），
 * T-NC10 样式相等断言守住零漂移。
 */
export const composerInputMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  /** 5 行封顶 = paddingV×2 + lineHeight×5 = 12 + 110。 */
  maxHeight: 122,
} as const;

/**
 * token 胶囊视觉数值（D2 补丁一的 span 数值，RN 侧样式映射单源）。
 *
 * 与 Kotlin `RoundedBackgroundSpan` 的消费口径对齐：color 取主题 `primary`、
 * 背景取 `primaryMuted`（颜色值是主题运行时数据，不落本表；本表只锁几何）。
 */
export const composerTokenCapsule = {
  borderRadius: 4,
  paddingHorizontal: 4,
  paddingTop: 1,
  paddingBottom: 1,
} as const;

import {StyleSheet} from 'react-native';
import {composerToolBtnStyle} from '@/components/chat/composer-toolbar-style';
import {attachmentDraftChipsStyles} from '@/components/chat/AttachmentDraftChips';

/** 引用类工具按钮（⛶ / @ / $）：36 见方圆钮 + hairline 描边 + 内容居中。 */
export {composerToolBtnStyle};

/**
 * chips 段 RN 真源（`AttachmentDraftChips.tsx` 的 `StyleSheet`，组件本体仍在生产中）。
 * 合成包 `.chips__row` / `.chip` / `.chip__label` 的数值全部对照它断言。
 */
export {attachmentDraftChipsStyles};

/* ==================================================================== *
 * Step 4 追加段：dock 外围件（容器 / hint / error / toolbar / typeahead 浮层）
 * 的 RN 数值单源。出处 = 退役前 `ChatComposer.tsx` 的 `styles.*`（dock/box/
 * hintRow/error/toolbar/sendBtn）与 `TypeaheadList.tsx`（list/行内边距），
 * 与 `chat-conversation.css` 的 dock 段（.dock__hint-row / .dock__error /
 * .dock__box / .typeahead / .toolbar）逐项同构；颜色值不落本表，由组件从
 * 主题 9 键取（--border 对应 `borderLight`，映射表见 web `host-theme.ts`）。
 * ==================================================================== */

/**
 * dock 底 padding 基准（web dock 的 `DOCK_PADDING_BASE` 同值迁入）。
 *
 * 键盘弹起时归零、否则 `max(8, safeAreaBottom)` 的派生在
 * `resolveDockBottomPadding`——语义与 web 逐字同构；web 侧那份待 Step 6 随
 * chat-conversation 包退役，两处短暂并存、以 T-NC10 对账。
 */
export const DOCK_PADDING_BASE = 8;

/**
 * dock 底 padding：键盘弹起时归零，否则 `max(base, safeAreaBottom)`。
 *
 * 键盘态由上层以 `keyboardUp` 布尔传入（controller 的 useAnimatedReaction
 * 布尔翻转派生，纪律 B）——RN 侧与 web 不同，不必担心「键盘高度不进视口」
 * 的自判问题，但传参形态保持与 composerState.keyboardUp 同源。
 */
export function resolveDockBottomPadding(
  keyboardUp: boolean,
  safeAreaBottom: number,
  base: number = DOCK_PADDING_BASE,
): number {
  return keyboardUp ? 0 : Math.max(base, safeAreaBottom);
}

/**
 * dock 容器与 toolbar 段（退役前 `ChatComposer.tsx` styles 逐项迁入）：
 * dock（实底 + 横向 12 / 顶 4，paddingBottom 运行时由
 * `resolveDockBottomPadding` 覆盖）/ box（输入区单一视觉容器）/ hint / error
 * 文本行 / toolbar 行与发送钮。
 */
export const composerDockStyles = StyleSheet.create({
  dock: {
    flexShrink: 0,
    // 实底由主题 background 注入；盖住转录区溢出，键盘顶起时不透出
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  /** typeahead 浮层的锚定壳（现网 .dock__box 内 .dock__input-area 的等价物）。 */
  inputArea: {
    position: 'relative',
  },
  hintRow: {
    marginBottom: 6,
  },
  hintText: {
    fontSize: 14,
  },
  error: {
    marginBottom: 6,
    fontSize: 13,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  toolbarSpacer: {
    flex: 1,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * typeahead 浮层段（`TypeaheadList.tsx` 的 list / 行内边距 + web CSS
 * `.typeahead` 的绝对定位形态逐项迁入）：锚定在输入区上缘整体浮起
 * （bottom: 100%），行内边距与退役前 RN 版一致（paddingH 10 / paddingV 8），
 * 字号对齐 web CSS（行 14 / tag 11）。
 */
export const composerTypeaheadStyles = StyleSheet.create({
  list: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    zIndex: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  row: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  /** 技能行：label 与来源 tag 横排（web `.typeahead__row--skill` gap 8）。 */
  rowSkill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowLabel: {
    fontSize: 14,
    flexShrink: 1,
  },
  rowTag: {
    flexShrink: 0,
    fontSize: 11,
  },
});
