/**
 * 聊天消息编辑弹窗。回车换行；仅按钮保存。
 * 多行输入对齐 ChatComposer 模式（TextInput 直挂 min/maxHeight），禁止 ScrollView 包裹。
 * 垂直位置：justifyContent center 居中面板。
 * 键盘避让：只给面板加 translateY 上移键盘高度的一半，走 GPU 合成层不触发 layout。
 * 遮罩保持 flex:1 覆盖全屏不动。readOnly 无需键盘避让。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {useTheme} from '@/theme/ThemeProvider';
import {AppModal} from '@/components/ui/AppModal';

const INPUT_MIN_HEIGHT = 120;

type Props = {
  visible: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  /** 只读预览：同高度输入框禁用编辑，操作栏改为删除/关闭/编辑。 */
  readOnly?: boolean;
  onClose: () => void;
  onConfirm?: (value: string) => void | Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function MessageEditModal({
  visible,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = '确定',
  readOnly = false,
  onClose,
  onConfirm,
  onEdit,
  onDelete,
}: Props) {
  const {tokens} = useTheme();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  // Android Modal 是独立 window，useReanimatedKeyboardAnimation 走 native event emitter
  // 在 Modal 内也能正常收事件。只给面板加 translateY，遮罩不动，不触发 flex layout。
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const panelAvoidStyle = useAnimatedStyle(() => {
    // 上移键盘高度的一半，既避免被键盘遮挡，又不至于推到屏幕顶部。
    // keyboardHeightSV.value 在键盘弹起时为负值（如 -250），收起时为 0。
    return {transform: [{translateY: Math.min(0, keyboardHeightSV.value) / 2}]};
  }, [keyboardHeightSV]);

  const inputMaxHeight = useMemo(() => {
    const windowHeight = Dimensions.get('window').height;
    // 为标题、标签、操作栏、padding 与键盘留出空间
    return Math.min(280, windowHeight * 0.32);
  }, []);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = !readOnly && trimmed.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit || !onConfirm) {
      return;
    }
    setSaving(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const displayValue = readOnly && !trimmed ? '（空说明）' : value;

  const actions = readOnly ? (
    <View style={styles.actionsRow}>
      {onDelete ? (
        <Pressable onPress={onDelete} style={styles.btn}>
          <Text style={{color: tokens.danger}}>删除</Text>
        </Pressable>
      ) : (
        <View />
      )}
      <View style={styles.actionsEnd}>
        <Pressable onPress={onClose} style={styles.btn}>
          <Text style={{color: tokens.textSecondary}}>关闭</Text>
        </Pressable>
        {onEdit ? (
          <Pressable onPress={onEdit} style={styles.btn}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>编辑</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : (
    <View style={styles.actions}>
      <Pressable onPress={onClose} style={styles.btn}>
        <Text style={{color: tokens.textSecondary}}>取消</Text>
      </Pressable>
      <Pressable
        onPress={() => handleConfirm().catch(() => undefined)}
        style={styles.btn}
        disabled={!canSubmit}
      >
        <Text
          style={{
            color: canSubmit ? tokens.primary : tokens.textTertiary,
            fontWeight: '600',
          }}
        >
          {saving ? '保存中…' : confirmLabel}
        </Text>
      </Pressable>
    </View>
  );

  const modalBody = (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Animated.View
        style={[
          styles.panel,
          {backgroundColor: tokens.surface},
          !readOnly ? panelAvoidStyle : undefined,
        ]}
        onStartShouldSetResponder={() => true}
      >
        <Pressable onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          {label ? (
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              {label}
            </Text>
          ) : null}
          <TextInput
            testID={
              readOnly ? 'message-edit-readonly-input' : 'message-edit-input'
            }
            style={[
              styles.input,
              {
                color: tokens.text,
                borderColor: tokens.border,
                backgroundColor: tokens.background,
                minHeight: INPUT_MIN_HEIGHT,
                maxHeight: inputMaxHeight,
              },
            ]}
            value={displayValue}
            onChangeText={readOnly ? undefined : setValue}
            placeholder={placeholder}
            placeholderTextColor={tokens.textSecondary}
            autoFocus={!readOnly}
            editable={!readOnly}
            showSoftInputOnFocus={!readOnly}
            scrollEnabled
            autoCorrect={false}
            multiline
            submitBehavior="newline"
            textAlignVertical="top"
          />
          {actions}
        </Pressable>
      </Animated.View>
    </Pressable>
  );

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      {modalBody}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 24,
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
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  actionsEnd: {
    flexDirection: 'row',
    gap: 16,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
