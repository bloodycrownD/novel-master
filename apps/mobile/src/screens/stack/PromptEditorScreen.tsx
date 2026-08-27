/**
 * 全屏提示词编辑页（R3→R5）：编辑体验对齐工作区 FileEditorScreen——
 * 同款 CodeEditorWebView 编辑 + FileMarkdownPreview 预览（含 Markdown/文本
 * SegmentedControl 切换），顶栏右侧「预览/编辑」切换按钮交互照搬工作区。
 * 提示词当作 markdown 对待：伪路径 prompt.md 让编辑器按 md 高亮、预览走
 * markdown 渲染（FileMarkdownPreview 只吃内存 content，不涉及 VFS 读写）。
 * 数据仍是 initialText 草稿 + onSaved 回调那套：保存才回填、取消不动原值。
 * 回调不走路由参数（不可序列化），挂载时从模块级存取取走（读后即清）。
 * 键盘顶起 follow FileEditorScreen：编辑态 Android 以 marginBottom 收缩键盘
 * 高度、iOS 用 KeyboardAvoidingView padding，预览态无软键盘直接铺开。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import {
  CodeEditorWebView,
  type CodeEditorWebViewHandle,
} from '../../components/vfs/CodeEditorWebView';
import {
  FileMarkdownPreview,
  type PreviewRenderKind,
} from '../../components/vfs/FileMarkdownPreview';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {
  takePromptEditorOnSaved,
  type PromptEditorOnSaved,
} from '../../components/agent/prompt-editor-callback';
import {useTheme} from '../../theme/ThemeProvider';

/** 伪路径以 .md 结尾：编辑器按 markdown 高亮，预览走 markdown 渲染管线。 */
const PROMPT_EDITOR_PATH = 'prompt.md';

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
  // 编辑/预览切换（交互照 FileEditorScreen）：入口按钮叫「全屏编辑」，
  // 进屏默认编辑态；预览渲染当前草稿，保存语义不变。
  const [previewMode, setPreviewMode] = useState(false);
  const [previewRenderKind, setPreviewRenderKind] =
    useState<PreviewRenderKind>('markdown');
  const codeEditorRef = useRef<CodeEditorWebViewHandle>(null);

  // 路由 title 参数可覆盖 header 静态标题（仿 ProviderDetail 的 stackOverride 用法）。
  useEffect(() => {
    if (!title) {
      return;
    }
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [title, setStackOverride]);

  const togglePreview = useCallback(() => {
    setPreviewMode(prev => {
      // 离开编辑态时收起编辑器焦点与软键盘（照 FileEditorScreen 的 dismissEditor）。
      if (!prev) {
        codeEditorRef.current?.blur();
        Keyboard.dismiss();
      }
      return !prev;
    });
  }, []);

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
        {/* 编辑/预览切换：位置和交互照工作区（预览态显示「编辑」，反之「预览」）。 */}
        <Pressable
          testID="prompt-editor-toggle"
          onPress={togglePreview}
          style={styles.toolbarBtn}
          accessibilityLabel={previewMode ? '编辑' : '预览'}>
          <Text
            style={[
              styles.toolbarText,
              {color: previewMode ? tokens.primary : tokens.textSecondary},
            ]}>
            {previewMode ? '编辑' : '预览'}
          </Text>
        </Pressable>
      </View>
      {previewMode ? (
        <SegmentedControl
          options={[
            {value: 'markdown', label: 'Markdown'},
            {value: 'txt', label: '文本'},
          ]}
          value={previewRenderKind}
          onChange={setPreviewRenderKind}
          tokens={tokens}
        />
      ) : null}
      {previewMode ? (
        /* WebView owns scroll — no outer ScrollView（照 FileEditorScreen）。 */
        <View style={[styles.preview, {backgroundColor: tokens.surface}]}>
          <FileMarkdownPreview
            path={PROMPT_EDITOR_PATH}
            content={draft}
            tokens={tokens}
            previewFill
            renderKind={previewRenderKind}
          />
        </View>
      ) : (
        <CodeEditorWebView
          ref={codeEditorRef}
          value={draft}
          path={PROMPT_EDITOR_PATH}
          onChange={setDraft}
          style={styles.editor}
        />
      )}
    </>
  );

  const rootStyle = [styles.root, {backgroundColor: tokens.background}];

  // 预览态无软键盘，直接铺开（照 FileEditorScreen）；编辑态 Android 抬升裁切、iOS padding。
  if (previewMode) {
    return <View style={rootStyle}>{editorBody}</View>;
  }

  if (Platform.OS === 'android') {
    return (
      <View style={rootStyle}>
        <AndroidKeyboardPromptEditorBody>
          {editorBody}
        </AndroidKeyboardPromptEditorBody>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={rootStyle}
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
  preview: {flex: 1, minHeight: 0, padding: 12},
  editor: {flex: 1, minHeight: 0},
});
