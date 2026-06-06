/** Shared placement math for anchored action menus (RN modal + WebView context menu). */

export const ANCHORED_MENU_GAP = 8;
export const ANCHORED_MENU_SCREEN_MARGIN = 12;
export const ANCHORED_MENU_ITEM_MIN_HEIGHT = 44;
export const ANCHORED_MENU_MAX_HEIGHT_CAP = 360;
export const ANCHORED_MENU_MIN_WIDTH = 132;
export const ANCHORED_MENU_MAX_WIDTH = 200;
export const ANCHORED_MENU_H_PADDING = 32;
/** Rough width per glyph for CJK/Latin labels without native measure. */
export const ANCHORED_MENU_CHAR_WIDTH_EST = 14;

export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function anchoredMenuMaxHeight(screenHeight: number): number {
  return Math.min(ANCHORED_MENU_MAX_HEIGHT_CAP, screenHeight * 0.45);
}

export function anchoredMenuContentHeight(itemCount: number): number {
  return itemCount * ANCHORED_MENU_ITEM_MIN_HEIGHT + 8;
}

export interface AnchoredMenuLayout {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Box height: content-sized, or viewport/cap bound when scrollable. */
  readonly maxHeight: number;
  readonly scrollable: boolean;
}

/** Content-aware width so short labels do not stretch to full screen. */
export function computeAnchoredMenuWidth(
  items: readonly {label: string}[],
  screenWidth: number,
): number {
  const longest = items.reduce(
    (max, item) => Math.max(max, item.label.length),
    0,
  );
  const byLabel = longest * ANCHORED_MENU_CHAR_WIDTH_EST + ANCHORED_MENU_H_PADDING;
  const cap = screenWidth - ANCHORED_MENU_SCREEN_MARGIN * 2;
  return Math.min(
    cap,
    ANCHORED_MENU_MAX_WIDTH,
    Math.max(ANCHORED_MENU_MIN_WIDTH, byLabel),
  );
}

/** Places the vertical menu above or below the anchor, clamped inside the viewport. */
export function layoutAnchoredMenu(
  anchor: MenuAnchor,
  itemCount: number,
  menuWidth: number,
  screenWidth: number,
  screenHeight: number,
): AnchoredMenuLayout {
  const heightCap = anchoredMenuMaxHeight(screenHeight);
  const contentHeight = anchoredMenuContentHeight(itemCount);
  const flipEstimate = Math.min(contentHeight, heightCap);

  const anchorCenterX = anchor.x + anchor.width / 2;
  let left = anchorCenterX - menuWidth / 2;
  left = Math.max(
    ANCHORED_MENU_SCREEN_MARGIN,
    Math.min(left, screenWidth - menuWidth - ANCHORED_MENU_SCREEN_MARGIN),
  );

  const spaceAbove = anchor.y;
  const spaceBelow = screenHeight - (anchor.y + anchor.height);
  // Prefer below unless it would clip; flip above when bottom space is tighter.
  const placeAbove =
    spaceBelow < flipEstimate + ANCHORED_MENU_GAP &&
    spaceAbove >= spaceBelow;

  const availableSpace =
    (placeAbove ? spaceAbove : spaceBelow) -
    ANCHORED_MENU_GAP -
    ANCHORED_MENU_SCREEN_MARGIN;
  const viewportBoundedMax = Math.min(
    heightCap,
    Math.max(ANCHORED_MENU_ITEM_MIN_HEIGHT, availableSpace),
  );
  const scrollable = contentHeight > viewportBoundedMax;
  const menuHeight = scrollable ? viewportBoundedMax : contentHeight;

  let top = placeAbove
    ? anchor.y - menuHeight - ANCHORED_MENU_GAP
    : anchor.y + anchor.height + ANCHORED_MENU_GAP;
  top = Math.max(
    ANCHORED_MENU_SCREEN_MARGIN,
    Math.min(top, screenHeight - menuHeight - ANCHORED_MENU_SCREEN_MARGIN),
  );

  return {left, top, width: menuWidth, maxHeight: menuHeight, scrollable};
}
