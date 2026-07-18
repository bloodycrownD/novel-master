/**
 * WebView boot 与 RN 侧共用的数值常量单源。
 * Web 入口只 import `shared/*`；RN 侧通过 re-export 消费。
 */

/** 距视觉底部 ≤ 此值视为贴底（流式 stick）。 */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** boot 历史别名（与 NEAR_BOTTOM_THRESHOLD_PX 同值）。 */
export const NEAR_BOTTOM = NEAR_BOTTOM_THRESHOLD_PX;

/** 长按菜单打开后忽略 bubble touchend 的宽限（ms）。 */
export const MENU_OPEN_GRACE_MS = 400;

/** 手指移动超过此像素则取消长按。 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export const ANCHORED_MENU_GAP = 8;
export const ANCHORED_MENU_SCREEN_MARGIN = 12;
export const ANCHORED_MENU_ITEM_MIN_HEIGHT = 44;
/** 每行布局估算（含边框与字号余量）。 */
export const ANCHORED_MENU_ITEM_LAYOUT_HEIGHT = 48;
/** 按压点锚点高度 — 避免用整段气泡矩形。 */
export const ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT = 32;
export const ANCHORED_MENU_MAX_HEIGHT_CAP = 360;
export const ANCHORED_MENU_MIN_WIDTH = 132;
export const ANCHORED_MENU_MAX_WIDTH = 200;
export const ANCHORED_MENU_H_PADDING = 32;
/** CJK/拉丁标签宽度粗估（无原生 measure）。 */
export const ANCHORED_MENU_CHAR_WIDTH_EST = 14;
/** 标准消息菜单项数 — WebView 楔形内不滚动。 */
export const MESSAGE_ACTION_MENU_ITEM_COUNT = 5;
