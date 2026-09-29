/**
 * chat 输入框全屏编辑屏（ChatComposer 工具栏 ⛶ 入口的目标屏）。
 *
 * 结构与宏链既有全屏（PromptEditorScreen）同款：复用 `EditorScreenShell`
 * （键盘三分支现成，**不接右侧预览切换**——聊天输入无预览需求），顶栏左
 * 「保存」+ 系统返回即取消（未保存改动由 `useUnsavedGuard` 拦截确认丢弃，
 * 对应 A13「取消丢弃」）。
 *
 * 内容区是 `ComposerInputWebView`（mode=composer-token，token 高亮与内联一致；
 * metrics 解除限高 → 容器 flex 全高、web 侧 max-height: none 内滚）。主题沿用
 * 宿主默认通道（useTheme tokens，与 ChatComposer 内联实例同款组装）。
 *
 * 数据通道照 `prompt-editor-callback` 模式：初始文本与保存回调都不走路由参数
 * （不可序列化），挂载时从 `composer-editor-callback` 读走（take 即清空）。
 */
import React, {useCallback, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SegmentOption} from '@/components/ui/SegmentedControl';
import {EditorScreenShell} from '@/components/chrome/EditorScreenShell';
import type {ComposerInputMetrics} from '@/components/chat/ComposerInputBridge';
import {ComposerInputWebView} from '@/components/chat/ComposerInputWebView';
import {
  takeComposerEditorCallback,
  type ComposerEditorPending,
} from '@/components/chat/composer-editor-callback';
import {useUnsavedGuard} from '@/hooks/useUnsavedGuard';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 全屏口径：与内联同字号行高，解除限高（maxHeight=null → 容器 flex 全高内滚）。 */
const FULLSCREEN_METRICS: ComposerInputMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: null,
};

const FULLSCREEN_TITLE = '编辑消息';

/**
 * shell 的预览三件套是必填 props，但本屏 previewMode 恒 false（不渲染预览区），
 * 这里只放占位值；`segmented.onChange` 也没有消费方。
 */
const PREVIEW_PLACEHOLDER_OPTIONS: readonly SegmentOption<string>[] = [
  {value: 'text', label: '文本'},
];

export function ChatComposerEditorScreen() {
  const {tokens} = useTheme();
  const navigation = useNavigation<Nav>();
  // 回调走模块级存取（路由参数必须可序列化）：挂载时读走并清空，取消路径不消费。
  const [pending] = useState<ComposerEditorPending | null>(() =>
    takeComposerEditorCallback(),
  );
  const initialText = pending?.initialText ?? '';
  // 屏内草稿 + 已保存基线（照 PromptEditorScreen 的 draft/savedDraft 对）。
  const [draft, setDraft] = useState(initialText);
  const [savedDraft, setSavedDraft] = useState(initialText);

  const isDirty = draft !== savedDraft;
  // 退出拦截同工作区：未保存改动离开前弹确认，确认离开即丢弃。
  const {allowLeaveWithoutPrompt} = useUnsavedGuard(isDirty);

  // 保存：回填调用方（父层注入的 onSaved 写草稿并刷新输入框）后返回。
  const handleSave = useCallback(() => {
    if (!isDirty) {
      return;
    }
    pending?.onSaved(draft);
    setSavedDraft(draft);
    // setSavedDraft 是异步 state：goBack 的 beforeRemove 当拍仍会读到旧 isDirty，
    // 必须同步放行标记，否则保存后被自己的未保存拦截弹窗拦下。
    allowLeaveWithoutPrompt();
    navigation.goBack();
  }, [draft, isDirty, navigation, pending, allowLeaveWithoutPrompt]);

  return (
    <EditorScreenShell
      tokens={tokens}
      toolbarBorderColor={tokens.borderLight}
      save={{
        testID: 'composer-editor-save',
        accessibilityLabel: '保存',
        label: '保存',
        disabled: !isDirty,
        onPress: handleSave,
      }}
      title={isDirty ? '未保存' : FULLSCREEN_TITLE}
      titleDanger={isDirty}
      segmented={{
        options: PREVIEW_PLACEHOLDER_OPTIONS,
        value: 'text',
        onChange: () => undefined,
      }}
      previewMode={false}
      preview={null}
      editor={
        <View style={styles.editor}>
          <ComposerInputWebView
            testID="composer-editor-input"
            mode="composer-token"
            metrics={FULLSCREEN_METRICS}
            value={draft}
            onChangeText={setDraft}
            placeholder="输入消息…"
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  /** flex 全高：宿主 maxHeight=null 时容器自己 flex:1，这里补上下文的伸展。 */
  editor: {flex: 1, minHeight: 0},
});
