/**
 * VfsFileManager 内联单输入弹窗（重命名/新建文件/新建目录）。
 * 骨架复用 ModalShell（居中卡片 + translate 0.5 键盘避让）。
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {ModalShell} from '@/components/ui/ModalShell';
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

  return (
    <ModalShell
      visible
      onClose={onCancel}
      variant="center"
      animationType="fade"
      backdropOpacity={0.45}
      keyboardAvoid={{kind: 'translate', fraction: 0.5}}
      panelStyle={styles.promptBox}
    >
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
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  // ModalShell center 容器带 alignItems:'center'（子元素收缩包裹），
  // 未声明宽度的面板会坍成内容宽——必须显式撑满（旧行为：接近全宽卡片）。
  promptBox: {width: '100%', borderRadius: 12, padding: 16},
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
