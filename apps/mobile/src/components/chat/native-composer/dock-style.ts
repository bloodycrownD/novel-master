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
 * **职责边界**：本文件**不进 bundle**（没有任何 web entry import 它），只是 RN/web 双侧的
 * 数值对照表，由 `chat-conversation-boot-script.test.ts` 消费（旧址同款纪律）。
 */
import {composerToolBtnStyle} from '@/components/chat/composer-toolbar-style';
import {attachmentDraftChipsStyles} from '@/components/chat/AttachmentDraftChips';

/** 引用类工具按钮（⛶ / @ / $）：36 见方圆钮 + hairline 描边 + 内容居中。 */
export {composerToolBtnStyle};

/**
 * chips 段 RN 真源（`AttachmentDraftChips.tsx` 的 `StyleSheet`，组件本体仍在生产中）。
 * 合成包 `.chips__row` / `.chip` / `.chip__label` 的数值全部对照它断言。
 */
export {attachmentDraftChipsStyles};
