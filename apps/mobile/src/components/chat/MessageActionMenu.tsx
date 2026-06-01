/**
 * WeChat/QQ-style anchored action bar for a single chat message bubble.
 */
import React, {useMemo} from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

const MENU_HEIGHT = 48;
const MENU_GAP = 8;
const SCREEN_MARGIN = 12;
const ITEM_MIN_WIDTH = 64;

/** Places the horizontal bar above or below the bubble, clamped inside the window. */
function layoutAnchoredMenu(
  anchor: MessageMenuAnchor,
  itemCount: number,
  screenWidth: number,
  screenHeight: number,
): {left: number; top: number; width: number} {
  const menuWidth = Math.min(
    screenWidth - SCREEN_MARGIN * 2,
    itemCount * ITEM_MIN_WIDTH + 16,
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
    spaceAbove >= MENU_HEIGHT + MENU_GAP ||
    spaceAbove >= spaceBelow;
  let top = placeAbove
    ? anchor.y - MENU_HEIGHT - MENU_GAP
    : anchor.y + anchor.height + MENU_GAP;
  top = Math.max(
    SCREEN_MARGIN,
    Math.min(top, screenHeight - MENU_HEIGHT - SCREEN_MARGIN),
  );

  return {left, top, width: menuWidth};
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
    return layoutAnchoredMenu(
      anchor,
      items.length,
      window.width,
      window.height,
    );
  }, [anchor, items.length, window.width, window.height]);

  return (
    <Modal
      visible={visible && layout != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {layout != null ? (
          <View
            style={[
              styles.bar,
              {
                left: layout.left,
                top: layout.top,
                width: layout.width,
                backgroundColor: tokens.surfaceElevated,
                borderColor: tokens.border,
              },
            ]}>
            {items.map((item, index) => (
              <Pressable
                key={item.action}
                style={[
                  styles.item,
                  index > 0 && {
                    borderLeftWidth: StyleSheet.hairlineWidth,
                    borderLeftColor: tokens.border,
                  },
                ]}
                onPress={() => {
                  onClose();
                  onSelect(item.action);
                }}>
                <Text
                  style={{
                    color: item.danger ? tokens.danger : tokens.text,
                    fontSize: 15,
                  }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minHeight: MENU_HEIGHT,
  },
  item: {
    flex: 1,
    minHeight: MENU_HEIGHT,
    minWidth: ITEM_MIN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
