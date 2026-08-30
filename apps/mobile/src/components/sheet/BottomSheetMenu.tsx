/**
 * Simple action sheet (Modal) aligned with prototype bottom sheet menus.
 * 吸收了原 SessionActionsDrawer（cr-fix-spec comp-rest/C-6）：未提供回调的项
 * 传 disabled 置灰不可点，不再需要平行的 drawer 实现。
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {ModalShell} from '@/components/ui/ModalShell';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '@/theme/ThemeProvider';

export interface SheetMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
  /** 置灰不可点（对应原 SessionActionsDrawer 的「未传 action 回调」项）。 */
  readonly disabled?: boolean;
}

type Props = {
  visible: boolean;
  title?: string;
  items: SheetMenuItem[];
  onSelect: (action: string) => void;
  onClose: () => void;
};

export function BottomSheetMenu({
  visible,
  title,
  items,
  onSelect,
  onClose,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant="bottom"
      animationType="slide"
      statusBarTranslucent
      backdropOpacity={0.55}
      panelStyle={[styles.sheet, {paddingBottom: Math.max(insets.bottom, 16)}]}
    >
      {title ? (
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          {title}
        </Text>
      ) : null}
      {items.map(item => (
        <Pressable
          key={item.action}
          style={[styles.item, {borderTopColor: tokens.border}]}
          disabled={item.disabled}
          onPress={() => {
            onClose();
            onSelect(item.action);
          }}
        >
          <Text
            style={{
              color: item.disabled
                ? tokens.textTertiary
                : item.danger
                ? tokens.danger
                : tokens.text,
              fontSize: 16,
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        style={[styles.item, {borderTopColor: tokens.border}]}
        onPress={onClose}
      >
        <Text style={{color: tokens.textSecondary, fontSize: 16}}>取消</Text>
      </Pressable>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  title: {
    textAlign: 'center',
    paddingVertical: 12,
    fontSize: 13,
  },
  item: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
