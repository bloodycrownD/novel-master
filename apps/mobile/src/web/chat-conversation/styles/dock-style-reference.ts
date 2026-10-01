/**
 * dock 视觉参照面（chat-webview-unify Step 6 顺手项 · cr1-P1-5 缩范围后瘦身）。
 *
 * **背景**：`ChatComposer.tsx` 是本迭代 Step 8 的删除对象，它的 `styles`
 * （dock / box / hintRow / error / sendBtn）是合成包 CSS 里 dock 段的数值出处。文件一删，
 * 数值出处随之消失，UI 一致性硬验收（逐屏截图对比）就失去可对照的 RN 真源。
 *
 * **cr1-P1-5 缩范围后本文件只剩两处导出**，判据只有一条：**RN 真源今天是否还活着**。
 * - `composerToolBtnStyle` —— 共享常量文件 `composer-toolbar-style.ts` 仍在，本身是纯常量，
 *   re-export 只是让参照面聚在一处、避免日后各抄一份。
 * - `attachmentDraftChipsStyles` —— chips 段唯一幸存的 RN 真源（`AttachmentDraftChips.tsx`
 *   随 legacy 转录引擎退役后仍然在用），且它的 StyleSheet 就是 dock 段 chips 数值的出处。
 *
 * **曾经逐字手抄的 8 份快照（dock / box / hintRow / error / sendBtn / toolbar /
 * toolbarSpacer / input metrics）已删除**：它们唯一的「真源」就是那份已经删掉的
 * `ChatComposer.tsx`，留着就等于在断言里手抄常量——CSS 改一份、快照不动，两边分叉时
 * 断言不但不红还会给出「已对齐」的假信号。无真源的样式项不进断言，改由合并后 QA 的
 * Step 10 截图对比承担（见 cr-fix-spec 的 cr1-P1-5 改法第 ③ 点）。
 *
 * 想复查当初那份快照抄的是什么，用可追溯的取法看历史版本（不要凭注释里的行号猜，
 * 文件已删，行号锚点无处可指）：
 *
 * ```sh
 * git show dc4c903b~1:apps/mobile/src/components/chat/ChatComposer.tsx
 * ```
 *
 * 其中 `styles` 定义在 713-762 行（dock 714-720 / hintRow 721-723 / error 724-727 /
 * box 728-734 / input 735-745 / toolbar 746-751 / toolbarSpacer 752-754 / sendBtn 755-761）。
 *
 * **职责边界**：本文件**不进 bundle**（没有任何 web entry import 它），只是 RN/web 双侧的
 * 数值对照表，由 `chat-conversation-boot-script.test.ts` 消费。
 */
import {composerToolBtnStyle} from '@/components/chat/composer-toolbar-style';
import {attachmentDraftChipsStyles} from '@/components/chat/AttachmentDraftChips';

/** 引用类工具按钮（⛶ / @ / $）：36 见方圆钮 + hairline 描边 + 内容居中。 */
export {composerToolBtnStyle};

/**
 * chips 段 RN 真源（`AttachmentDraftChips.tsx` 的 `StyleSheet`，组件本体仍在生产中）。
 * 合成包 `.chips__row` / `.chip` / `.chip__label` 的数值全部对照它断言
 * （cr1-P1-5 首批范围之一；另一个首批是上面的 toolbar 四值）。
 */
export {attachmentDraftChipsStyles};
