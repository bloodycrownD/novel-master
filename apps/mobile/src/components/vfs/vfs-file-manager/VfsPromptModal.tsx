/**
 * VfsFileManager 内联单输入弹窗（重命名/新建文件/新建目录）。
 *
 * 骨架沿用 AppModal（ModalShell 统一骨架就位前不切换）；
 * iOS 走 KeyboardAvoidingView，Android 在弹层上挂 translateY 避让。
 */
import React, {useEffect, useState} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {AppModal} from '@/components/ui/AppModal';
import {useAndroidModalKeyboardAvoid} from '@/hooks/useAndroidModalKeyboardAvoid';
import {useTheme} from '@/theme/ThemeProvider';

export type VfsPromptState = {
  title: string;
  placeholder: string;
  defaultValue: string;
  onSubmit: (value: string) => Promise<void>;
};

type Props = {
  state: VfsPromptState;
  onCancel: () => void;
  onSubmit: (value: string) => void;
};

export function VfsPromptModal({state, onCancel, onSubmit}: Props) {
  const {tokens} = useTheme();
  const [value, setValue] = useState(state.defaultValue);
  // 每次打开（父组件换新 state）都重置回 defaultValue。
  useEffect(() => {
    setValue(state.defaultValue);
  }, [state]);
  // 内联 prompt 是居中弹层（promptBackdrop justifyContent center），
  // 上移键盘高度的一半就能露出输入框。
  const promptAvoidStyle = useAndroidModalKeyboardAvoid(0.5);

  const promptBody = (
    <View style={styles.promptBackdrop}>
      <Animated.View
        style={[
          styles.promptBox,
          {backgroundColor: tokens.surface},
          Platform.OS === 'android' ? promptAvoidStyle : undefined,
        ]}
        onStartShouldSetResponder={() => true}>
        <Text style={[styles.promptTitle, {color: tokens.text}]}>
          {state.title}
        </Text>
        <TextInput
          testID="vfs-prompt-input"
          style={[
            styles.promptInput,
            {borderColor: tokens.border, color: tokens.text},
          ]}
          placeholder={state.placeholder}
          placeholderTextColor={tokens.textSecondary}
          value={value}
          onChangeText={setValue}
          autoFocus
        />
        <View style={styles.promptActions}>
          <Pressable onPress={onCancel}>
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
          <Pressable testID="vfs-prompt-submit" onPress={() => onSubmit(value)}>
            <Text style={{color: tokens.primary}}>确定</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );

  return (
    <AppModal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.promptAvoidingRoot}>
          {promptBody}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.promptAvoidingRoot}>{promptBody}</View>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  promptAvoidingRoot: {
    flex: 1,
  },
  promptBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  promptBox: {borderRadius: 12, padding: 16},
  promptTitle: {fontSize: 16, fontWeight: '600', marginBottom: 12},
  promptInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 16,
  },
});
