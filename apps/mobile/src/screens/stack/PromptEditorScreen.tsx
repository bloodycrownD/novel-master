/**
 * 全屏提示词编辑页（R3）：CodeEditorWebView 草稿副本编辑，保存才回填，
 * 取消/Android 返回键不动原值。伪路径 prompt.txt 让编辑器按纯文本高亮。
 * 回调不走路由参数（不可序列化），挂载时从模块级存取取走（读后即清）。
 * 键盘顶起与顶栏 follow FileEditorScreen：Android 以 marginBottom 收缩键盘高度，
 * iOS 用 KeyboardAvoidingView padding；顶栏左右两角——左「取消」右「保存」。
 */
import React, {useEffect, useRef, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/types';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {CodeEditorWebView} from '../../components/vfs/CodeEditorWebView';
import {
  takePromptEditorOnSaved,
  type PromptEditorOnSaved,
} from '../../components/agent/prompt-editor-callback';
import {useTheme} from '../../theme/ThemeProvider';

type PromptEditorRoute = RouteProp<RootStackParamList, 'PromptEditor'>;
type PromptEditorNav = NativeStackNavigationProp<
  RootStackParamList,
  'PromptEditor'
>;

/**
 * Android：与 FileEditorScreen 同款——裁切窗口用 marginBottom 收缩键盘高度，
 * 内容区（flex:1）跟着缩到键盘以上，编辑区与顶栏保存按钮保持可见。
 */
function AndroidKeyboardPromptEditorBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  // hook 返回的 height 是负数，取反得到正的键盘高度。
  const clipStyle = useAnimatedStyle(() => {
    return {marginBottom: -keyboardHeightSV.value};
  }, [keyboardHeightSV]);

  return (
    <Animated.View style={[styles.keyboardClip, clipStyle]}>
      <View style={styles.keyboardLiftBody}>{children}</View>
    </Animated.View>
  );
}

export function PromptEditorScreen() {
  const {tokens} = useTheme();
  const navigation = useNavigation<PromptEditorNav>();
  const route = useRoute<PromptEditorRoute>();
  const {title, initialText} = route.params;
  const {setStackOverride} = useHeaderContext();
  // 回调走模块级存取（路由参数必须可序列化）：挂载时读走并清空，
  // 取消/卸载不消费即随 ref 一起丢弃，不残留旧回调。
  const onSavedRef = useRef<PromptEditorOnSaved | null>(
    takePromptEditorOnSaved(),
  );
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

  const editorBody = (
    <>
      <View style={[styles.toolbar, {borderBottomColor: tokens.borderLight}]}>
        <Pressable
          testID="prompt-editor-cancel"
          onPress={() => navigation.goBack()}
          style={styles.toolbarBtn}
          accessibilityLabel="取消">
          <Text style={[styles.toolbarText, {color: tokens.textSecondary}]}>
            取消
          </Text>
        </Pressable>
        <View style={styles.toolbarTitle}>
          <Text
            style={[
              styles.toolbarTitleText,
              {color: tokens.textSecondary},
            ]}
            numberOfLines={1}
            ellipsizeMode="tail">
            {title ?? '提示词'}
          </Text>
        </View>
        <Pressable
          testID="prompt-editor-save"
          onPress={() => {
            onSavedRef.current?.(draft);
            navigation.goBack();
          }}
          style={styles.toolbarBtn}
          accessibilityLabel="保存">
          <Text style={[styles.toolbarText, {color: tokens.primary}]}>
            保存
          </Text>
        </Pressable>
      </View>
      <CodeEditorWebView
        value={draft}
        path="prompt.txt"
        onChange={setDraft}
        style={styles.editor}
      />
    </>
  );

  // 键盘顶起与 FileEditorScreen 编辑态一致：Android 抬升裁切，iOS padding。
  if (Platform.OS === 'android') {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <AndroidKeyboardPromptEditorBody>
          {editorBody}
        </AndroidKeyboardPromptEditorBody>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, {backgroundColor: tokens.background}]}
      behavior="padding"
      automaticOffset>
      {editorBody}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  keyboardClip: {flex: 1, minHeight: 0, overflow: 'hidden'},
  keyboardLiftBody: {flex: 1, minHeight: 0},
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarBtn: {flexShrink: 0},
  toolbarTitle: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  toolbarTitleText: {textAlign: 'center', fontSize: 13},
  toolbarText: {fontSize: 14, fontWeight: '600'},
  editor: {flex: 1, minHeight: 0},
});
