/**
 * 全屏提示词编辑页（R3→R6）：顶栏完全照搬工作区 FileEditorScreen——
 * 左「保存」+ 中 标题/「未保存」+ 右「编辑/预览」单按钮互切。
 * 保存语义同工作区：保存后停留在当前态、清除未保存标记、toast 提示；
 * 区别在于没有 VFS 写入，保存只发 onSaved 回调（回填调用方表单）。
 * 退出走 header 返回/手势，未保存改动由 useUnsavedGuard 弹确认拦截
 * （与工作区同款），确认离开即丢弃草稿。
 * 提示词当作 markdown 对待：伪路径 prompt.md 让编辑器按 md 高亮、预览走
 * markdown 渲染（FileMarkdownPreview 只吃内存 content，不涉及 VFS 读写）。
 * 回调不走路由参数（不可序列化），挂载时从模块级存取取走（读后即清）。
 * 顶栏/预览二态/键盘三分支外壳由 components/chrome/EditorScreenShell 统一提供
 * （与工作区 FileEditorScreen 共用）。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Keyboard} from 'react-native';
import {useRoute, type RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '../../navigation/types';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import {useToast} from '../../components/chrome/ToastHost';
import {
  CodeEditorWebView,
  type CodeEditorWebViewHandle,
} from '../../components/vfs/CodeEditorWebView';
import {
  FileMarkdownPreview,
  type PreviewRenderKind,
} from '../../components/vfs/FileMarkdownPreview';
import {EditorScreenShell} from '../../components/chrome/EditorScreenShell';
import {
  takePromptEditorOnSaved,
  type PromptEditorOnSaved,
} from '../../components/agent/prompt-editor-callback';
import {useTheme} from '../../theme/ThemeProvider';

/** 伪路径以 .md 结尾：编辑器按 markdown 高亮，预览走 markdown 渲染管线。 */
const PROMPT_EDITOR_PATH = 'prompt.md';

type PromptEditorRoute = RouteProp<RootStackParamList, 'PromptEditor'>;

export function PromptEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const route = useRoute<PromptEditorRoute>();
  const {title, initialText} = route.params;
  const {setStackOverride} = useHeaderContext();
  // 回调走模块级存取（路由参数必须可序列化）：挂载时读走并清空，
  // 未保存即离开时不消费，随 ref 一起丢弃，不残留旧回调。
  const onSavedRef = useRef<PromptEditorOnSaved | null>(
    takePromptEditorOnSaved(),
  );
  // 屏内草稿 + 已保存基线（照 FileEditorScreen 的 content/savedContent 对）：
  // 保存只回填调用方并推进基线，不离开页面。
  const [draft, setDraft] = useState(initialText);
  const [savedDraft, setSavedDraft] = useState(initialText);
  // 编辑/预览切换（照 FileEditorScreen）：入口按钮叫「全屏编辑」，
  // 进屏默认编辑态；预览渲染当前草稿，保存语义见上。
  const [previewMode, setPreviewMode] = useState(false);
  const [previewRenderKind, setPreviewRenderKind] =
    useState<PreviewRenderKind>('markdown');
  const codeEditorRef = useRef<CodeEditorWebViewHandle>(null);

  const isDirty = draft !== savedDraft;
  // 退出拦截同工作区：未保存改动离开前弹确认，确认离开即丢弃。
  useUnsavedGuard(isDirty);

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

  // 保存（照 FileEditorScreen handleSave 的可保存条件）：编辑态且有改动才生效。
  // 无 VFS 写入：发 onSaved 回调 + 推进基线 + toast，停留在当前态。
  const handleSave = useCallback(() => {
    if (previewMode || !isDirty) {
      return;
    }
    onSavedRef.current?.(draft);
    setSavedDraft(draft);
    showToast('已保存');
  }, [previewMode, isDirty, draft, showToast]);

  // 预览态无软键盘，直接铺开；编辑态键盘抬升/裁切分支由 EditorScreenShell 统一处理。
  return (
    <EditorScreenShell
      tokens={tokens}
      toolbarBorderColor={tokens.borderLight}
      save={{
        testID: 'prompt-editor-save',
        accessibilityLabel: '保存',
        label: '保存',
        disabled: previewMode || !isDirty,
        onPress: handleSave,
      }}
      title={isDirty ? '未保存' : (title ?? '提示词')}
      titleDanger={isDirty}
      toggle={{
        testID: 'prompt-editor-toggle',
        accessibilityLabel: previewMode ? '编辑' : '预览',
        previewMode,
        onPress: togglePreview,
      }}
      segmented={{
        options: [
          {value: 'markdown', label: 'Markdown'},
          {value: 'txt', label: '文本'},
        ],
        value: previewRenderKind,
        onChange: setPreviewRenderKind,
      }}
      previewMode={previewMode}
      preview={
        <FileMarkdownPreview
          path={PROMPT_EDITOR_PATH}
          content={draft}
          tokens={tokens}
          previewFill
          renderKind={previewRenderKind}
        />
      }
      editor={
        <CodeEditorWebView
          ref={codeEditorRef}
          value={draft}
          path={PROMPT_EDITOR_PATH}
          onChange={setDraft}
        />
      }
    />
  );
}
