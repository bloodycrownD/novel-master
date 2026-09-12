/**
 * 正则字段全屏编辑页（照 agent 配置 PromptEditorScreen 先例）：
 * 顶栏左「保存」+ 中 标题/「未保存」，无预览态（正则无 markdown
 * 预览语义）。保存只发 onSaved 回调（回填调用方表单）+ toast，
 * 停留当前态、清除未保存标记；退出走 header 返回/手势，未保存改动
 * 由 useUnsavedGuard 弹确认拦截（与提示词编辑同款），确认离开即丢弃
 * 草稿。回调不走路由参数（不可序列化），挂载时从模块级存取取走
 * （读后即清）。编辑器复用 CodeEditorWebView，伪路径 pattern.txt
 * 让编辑器按纯文本处理。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, View} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '@/navigation/types';
import {useHeaderContext} from '@/navigation/HeaderContext';
import {useUnsavedGuard} from '@/hooks/useUnsavedGuard';
import {useToast} from '@/components/chrome/ToastHost';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {AndroidKeyboardClipBody} from '@/components/chrome/AndroidKeyboardClipBody';
import {
  CodeEditorWebView,
} from '@/components/vfs/CodeEditorWebView';
import {EditorScreenShell} from '@/components/chrome/EditorScreenShell';
import {
  takePatternEditorOnSaved,
  type PatternEditorOnSaved,
} from '@/components/smart-sort/pattern-editor-callback';
import {useTheme} from '@/theme/ThemeProvider';

/** 伪路径以 .txt 结尾：编辑器按纯文本处理（正则无专属语言模式）。 */
const PATTERN_EDITOR_PATH = 'pattern.txt';

type PatternEditorRoute = RouteProp<RootStackParamList, 'PatternEditor'>;

export function PatternFullscreenEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const route = useRoute<PatternEditorRoute>();
  const {title, initialText} = route.params;
  const {setStackOverride} = useHeaderContext();
  // 回调走模块级存取（路由参数必须可序列化）：挂载时读走并清空，
  // 未保存即离开时不消费，随 ref 一起丢弃，不残留旧回调。
  const onSavedRef = useRef<PatternEditorOnSaved | null>(
    takePatternEditorOnSaved(),
  );
  // 屏内草稿 + 已保存基线（照 PromptEditorScreen 的 draft/savedDraft 对）：
  // 保存只回填调用方并推进基线，不离开页面。
  const [draft, setDraft] = useState(initialText);
  const [savedDraft, setSavedDraft] = useState(initialText);

  const isDirty = draft !== savedDraft;
  // 退出拦截：未保存改动离开前弹确认，确认离开即丢弃。
  useUnsavedGuard(isDirty);

  // 路由 title 参数可覆盖 header 静态标题（照 PromptEditorScreen）。
  useEffect(() => {
    if (!title) {
      return;
    }
    setStackOverride({title});
    return () => setStackOverride(undefined);
  }, [title, setStackOverride]);

  // 保存：发 onSaved 回调 + 推进基线 + toast，停留在当前页。
  const handleSave = useCallback(() => {
    if (!isDirty) {
      return;
    }
    onSavedRef.current?.(draft);
    setSavedDraft(draft);
    showToast('已保存');
  }, [isDirty, draft, showToast]);

  // 键盘避让：仓库范式 A（ChatHistorySearchScreen 同款）——iOS 走 keyboard-controller
  // 的 KeyboardAvoidingView padding；Android 上 behavior={undefined} 等于啥也不干，
  // 改用 AndroidKeyboardClipBody 裁切窗口 marginBottom 收缩（编辑区 flex:1 跟着缩，
  // 内容可滚动、光标行贴在键盘上方）。RN 0.85 + targetSdk 36 默认 edge-to-edge 下
  // Manifest 的 adjustResize 不可依赖，须显式避让。
  const shell = (
    <EditorScreenShell
      tokens={tokens}
      toolbarBorderColor={tokens.borderLight}
      save={{
        testID: 'pattern-editor-save',
        accessibilityLabel: '保存',
        label: '保存',
        disabled: !isDirty,
        onPress: handleSave,
      }}
      title={isDirty ? '未保存' : title ?? '正则编辑'}
      titleDanger={isDirty}
      // 本屏无预览态：previewMode 恒 false，segmented/preview 不渲染
      // （EditorScreenShell 的 segmented 为必填 prop，传空占位）。
      segmented={{options: [], value: 'txt', onChange: () => undefined}}
      previewMode={false}
      preview={null}
      editor={
        <CodeEditorWebView
          value={draft}
          path={PATTERN_EDITOR_PATH}
          onChange={setDraft}
        />
      }
    />
  );
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={{flex: 1}} behavior="padding">
      {shell}
    </KeyboardAvoidingView>
  ) : (
    <AndroidKeyboardClipBody>
      <View style={{flex: 1}}>{shell}</View>
    </AndroidKeyboardClipBody>
  );
}
