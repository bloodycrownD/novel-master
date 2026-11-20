/**
 * Forward DOM scroll helpers for WebView transcript (no column-reverse / inverted).
 * nearBottom: distance from visual bottom ≤ threshold ⇒ stick on stream updates.
 *
 * 公式单源：`web/shared/scroll-math.ts`；数值常量真源：`web/shared/constants.ts`。
 * 本文件保留宿主侧入口名（测试与 RN 消费），不重复公式。
 */
import {ScrollMath} from '@/web/shared/scroll-math';

export {NEAR_BOTTOM_THRESHOLD_PX} from '@/web/shared/constants';

export const {offsetFromBottom, isNearBottomOffset, nearBottom, scrollTopForBottom, scrollTopForOffsetFromBottom, scrollTopAfterPrepend, clampScrollTop} = ScrollMath;
