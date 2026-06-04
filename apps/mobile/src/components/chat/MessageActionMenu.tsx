/**
 * WeChat/QQ-style anchored action bar for a single chat message bubble.
 */
import React, {useMemo} from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

export interface MessageMenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MessageActionMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

type Props = {
  visible: boolean;
  anchor: MessageMenuAnchor | undefined;
  items: readonly MessageActionMenuItem[];
  onSelect: (action: string) => void;
  onClose: () => void;
};

const MENU_GAP = 8;
const SCREEN_MARGIN = 12;
const ITEM_MIN_HEIGHT = 44;
const MENU_MAX_HEIGHT_CAP = 360;
const MENU_MIN_WIDTH = 132;
const MENU_MAX_WIDTH = 200;
const MENU_H_PADDING = 32;
/** Rough width per glyph for CJK/Latin labels without native measure. */
const MENU_CHAR_WIDTH_EST = 14;

/** Vertical menu max height for small screens. */
export function messageActionMenuMaxHeight(screenHeight: number): number {
  return Math.min(MENU_MAX_HEIGHT_CAP, screenHeight * 0.45);
}

/** Content-aware width so short labels do not stretch to full screen. */
export function computeMessageActionMenuWidth(
  items: readonly {label: string}[],
  screenWidth: number,
): number {
  const longest = items.reduce(
    (max, item) => Math.max(max, item.label.length),
    0,
  );
  const byLabel = longest * MENU_CHAR_WIDTH_EST + MENU_H_PADDING;
  const cap = screenWidth - SCREEN_MARGIN * 2;
  return Math.min(cap, MENU_MAX_WIDTH, Math.max(MENU_MIN_WIDTH, byLabel));
}

/** Places the vertical menu above or below the bubble, clamped inside the window. */
export function layoutAnchoredMenu(
  anchor: MessageMenuAnchor,
  itemCount: number,
  menuWidth: number,
  screenWidth: number,
  screenHeight: number,
): {left: number; top: number; width: number; maxHeight: number} {
  const maxHeight = messageActionMenuMaxHeight(screenHeight);
  const estimatedHeight = Math.min(
    maxHeight,
    itemCount * ITEM_MIN_HEIGHT + 8,
  );

  const bubbleCenterX = anchor.x + anchor.width / 2;
  let left = bubbleCenterX - menuWidth / 2;
  left = Math.max(
    SCREEN_MARGIN,
    Math.min(left, screenWidth - menuWidth - SCREEN_MARGIN),
  );

  const spaceAbove = anchor.y;
  const spaceBelow = screenHeight - (anchor.y + anchor.height);
  const placeAbove =
    spaceAbove >= estimatedHeight + MENU_GAP ||
    spaceAbove >= spaceBelow;
  let top = placeAbove
    ? anchor.y - estimatedHeight - MENU_GAP
    : anchor.y + anchor.height + MENU_GAP;
  top = Math.max(
    SCREEN_MARGIN,
    Math.min(top, screenHeight - estimatedHeight - SCREEN_MARGIN),
  );

  return {left, top, width: menuWidth, maxHeight};
}

export function MessageActionMenu({
  visible,
  anchor,
  items,
  onSelect,
  onClose,
}: Props) {
  const {tokens} = useTheme();
  const window = Dimensions.get('window');
  const layout = useMemo(() => {
    if (anchor == null || items.length === 0) {
      return undefined;
    }
    const menuWidth = computeMessageActionMenuWidth(items, window.width);
    return layoutAnchoredMenu(
      anchor,
      items.length,
      menuWidth,
      window.width,
      window.height,
    );
  }, [anchor, items, window.width, window.height]);

  return (
    <AppModal
      visible={visible && layout != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {layout != null ? (
          <View
            style={[
              styles.menu,
              {
                left: layout.left,
                top: layout.top,
                width: layout.width,
                maxHeight: layout.maxHeight,
                backgroundColor: tokens.surfaceElevated,
                borderColor: tokens.border,
              },
            ]}>
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={items.length > 5}>
              {items.map(item => (
                <Pressable
                  key={item.action}
                  style={[
                    styles.item,
                    {borderBottomColor: tokens.border},
                  ]}
                  onPress={() => {
                    onClose();
                    onSelect(item.action);
                  }}>
                  <Text
                    style={{
                      color: item.danger ? tokens.danger : tokens.text,
                      fontSize: 15,
                      textAlign: 'center',
                    }}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  menu: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  item: {
    minHeight: ITEM_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
