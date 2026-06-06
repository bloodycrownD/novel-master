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
import {
  ANCHORED_MENU_ITEM_MIN_HEIGHT,
  ANCHORED_MENU_SCREEN_MARGIN,
  computeAnchoredMenuWidth,
  layoutAnchoredMenu,
  type MenuAnchor,
} from './anchored-menu-layout';

export type MessageMenuAnchor = MenuAnchor;

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

export {
  anchoredMenuMaxHeight as messageActionMenuMaxHeight,
  computeAnchoredMenuWidth as computeMessageActionMenuWidth,
  layoutAnchoredMenu,
} from './anchored-menu-layout';

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
    const menuWidth = computeAnchoredMenuWidth(items, window.width);
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
    minHeight: ANCHORED_MENU_ITEM_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: ANCHORED_MENU_SCREEN_MARGIN,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
