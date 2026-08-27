/**
 * 全屏提示词编辑页（R3）：CodeEditorWebView 草稿副本编辑，保存才回填（onSaved），
 * 取消/Android 返回键不动原值。伪路径 prompt.txt 让编辑器按纯文本高亮。
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/types';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {CodeEditorWebView} from '../../components/vfs/CodeEditorWebView';
import {useTheme} from '../../theme/ThemeProvider';

type PromptEditorRoute = RouteProp<RootStackParamList, 'PromptEditor'>;
type PromptEditorNav = NativeStackNavigationProp<
  RootStackParamList,
  'PromptEditor'
>;

export function PromptEditorScreen() {
  const {tokens} = useTheme();
  const navigation = useNavigation<PromptEditorNav>();
  const route = useRoute<PromptEditorRoute>();
  const {title, initialText, onSaved} = route.params;
  const {setStackOverride} = useHeaderContext();
  // 屏内草稿：只在保存时才把草稿回填给调用方，取消不动。
  const [draft, setDraft] = useState(initialText);

  // 路由 title 参数可覆盖 header 静态标题（仿 ProviderDetail 的 stackOverride 用法）。
  useEffect(() => {
    if (!title) {
      return;
    }
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [title, setStackOverride]);

  return (
    <View style={styles.root}>
      <View style={[styles.actionRow, {borderBottomColor: tokens.borderLight}]}>
        <Pressable
          testID="prompt-editor-cancel"
          onPress={() => navigation.goBack()}
          style={[styles.actionBtn, {borderColor: tokens.borderLight}]}
          accessibilityLabel="取消">
          <Text style={[styles.actionText, {color: tokens.textSecondary}]}>
            取消
          </Text>
        </Pressable>
        <Pressable
          testID="prompt-editor-save"
          onPress={() => {
            onSaved?.(draft);
            navigation.goBack();
          }}
          style={[styles.actionBtn, styles.saveBtn, {backgroundColor: tokens.primary}]}
          accessibilityLabel="保存">
          <Text style={[styles.actionText, {color: tokens.surface}]}>保存</Text>
        </Pressable>
      </View>
      <CodeEditorWebView value={draft} path="prompt.txt" onChange={setDraft} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  saveBtn: {borderWidth: 0},
  actionText: {fontSize: 14, fontWeight: '600'},
});
