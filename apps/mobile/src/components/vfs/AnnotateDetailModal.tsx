/**
 * 批注详情弹窗：可滚动预览原文与说明，替代原生 Alert（长文可读）。
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
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '@/theme/ThemeProvider';
import {AppModal} from '@/components/ui/AppModal';

type Props = {
  visible: boolean;
  originalText: string;
  userAnnotation: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function AnnotateDetailModal({
  visible,
  originalText,
  userAnnotation,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const bodyMaxHeight = useMemo(() => {
    const windowHeight = Dimensions.get('window').height;
    return Math.min(360, windowHeight * 0.45);
  }, []);

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, {paddingBottom: 24 + insets.bottom}]}
        onPress={onClose}>
        <View style={styles.topSpacer} />
        <Pressable
          style={[styles.panel, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>批注</Text>
          <ScrollView
            style={{maxHeight: bodyMaxHeight}}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator>
            {originalText.trim() ? (
              <>
                <Text style={[styles.sectionLabel, {color: tokens.textSecondary}]}>
                  原文
                </Text>
                <Text style={[styles.body, {color: tokens.textSecondary}]}>
                  {originalText}
                </Text>
              </>
            ) : null}
            <Text style={[styles.sectionLabel, {color: tokens.textSecondary}]}>
              说明
            </Text>
            <Text style={[styles.body, {color: tokens.text}]}>
              {userAnnotation.trim() ? userAnnotation : '（空说明）'}
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable onPress={onDelete} style={styles.btn}>
              <Text style={{color: tokens.danger}}>删除</Text>
            </Pressable>
            <View style={styles.actionsRight}>
              <Pressable onPress={onClose} style={styles.btn}>
                <Text style={{color: tokens.textSecondary}}>关闭</Text>
              </Pressable>
              <Pressable onPress={onEdit} style={styles.btn}>
                <Text style={{color: tokens.primary, fontWeight: '600'}}>
                  编辑
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
        <View style={styles.bottomSpacer} />
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 24,
  },
  topSpacer: {
    flex: 1,
    flexShrink: 0,
    minHeight: 0,
  },
  bottomSpacer: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  actionsRight: {
    flexDirection: 'row',
    gap: 16,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
