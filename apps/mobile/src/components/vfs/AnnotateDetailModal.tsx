/**
 * 批注详情弹窗：可滚动预览批注说明（替代原生 Alert）。
 * 面板与 backdrop 分离，避免外层 Pressable 抢走 ScrollView 手势。
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
  userAnnotation: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function AnnotateDetailModal({
  visible,
  userAnnotation,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const bodyHeight = useMemo(() => {
    const windowHeight = Dimensions.get('window').height;
    return Math.min(360, Math.round(windowHeight * 0.45));
  }, []);

  const bodyText = userAnnotation.trim() ? userAnnotation : '（空说明）';

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <View style={[styles.backdrop, {paddingBottom: 24 + insets.bottom}]}>
        <Pressable style={styles.topSpacer} onPress={onClose} />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
          <Text style={[styles.title, {color: tokens.text}]}>批注</Text>
          <ScrollView
            style={[styles.scroll, {height: bodyHeight}]}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            bounces>
            <Text style={[styles.body, {color: tokens.text}]} selectable>
              {bodyText}
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
        </View>
        <Pressable style={styles.bottomSpacer} onPress={onClose} />
      </View>
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
    alignSelf: 'stretch',
    minHeight: 0,
  },
  bottomSpacer: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: 0,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    flexShrink: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  scroll: {
    width: '100%',
  },
  scrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
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
