/**
 * 同文多条批注时先选一条再打开详情。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {AnnotateDraft} from '@novel-master/core/chat';
import {useTheme} from '@/theme/ThemeProvider';
import {AppModal} from '@/components/ui/AppModal';

type Props = {
  readonly visible: boolean;
  readonly drafts: readonly AnnotateDraft[];
  readonly onPick: (draft: AnnotateDraft) => void;
  readonly onClose: () => void;
};

export function AnnotatePickModal({
  visible,
  drafts,
  onPick,
  onClose,
}: Props) {
  const {tokens} = useTheme();

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="关闭选择批注">
        <Pressable
          style={[styles.card, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>选择批注</Text>
          <View style={styles.list}>
            {drafts.map(d => (
              <Pressable
                key={d.id}
                style={[
                  styles.item,
                  {borderBottomColor: tokens.borderLight},
                ]}
                onPress={() => onPick(d)}
                accessibilityRole="button"
                accessibilityLabel={d.userAnnotation || '空说明'}>
                <Text style={[styles.itemText, {color: tokens.text}]}>
                  {d.userAnnotation || '（空说明）'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.cancel}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="取消">
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    borderRadius: 12,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  list: {
    paddingHorizontal: 4,
  },
  item: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemText: {
    fontSize: 15,
    lineHeight: 22,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
  },
});
