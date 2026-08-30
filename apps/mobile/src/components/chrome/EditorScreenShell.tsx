/**
 * 编辑器屏外壳（screens/C-8 收敛）：FileEditorScreen 与 PromptEditorScreen
 * 共用的「左保存 + 中标题/未保存 + 右编辑/预览切换」toolbar、预览态
 * SegmentedControl、预览/编辑二态内容与键盘三分支布局（预览直铺、Android
 * 裁切抬升、iOS KeyboardAvoidingView padding）。
 *
 * 屏差异全部走 props：保存禁用态与文案、标题（含 danger 着色与「点按收起
 * 键盘」变体）、toolbar 下附加行（如文件编辑的统计行）、预览渲染档位配置，
 * 以及 preview / editor 两个内容 slot。
 */
import React from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {ThemeTokens} from '@/theme/tokens';
import {
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui/SegmentedControl';
import {AndroidKeyboardClipBody} from '@/components/chrome/AndroidKeyboardClipBody';

export type EditorScreenShellProps<T extends string> = {
  tokens: ThemeTokens;
  /** toolbar 底部分隔线颜色（两屏分别取 tokens.border / borderLight）。 */
  toolbarBorderColor: string;
  save: {
    testID?: string;
    accessibilityLabel?: string;
    /** 如「保存 / 保存中…」。 */
    label: string;
    disabled: boolean;
    onPress: () => void;
  };
  /** 有未保存改动时调用方改传「未保存」，由 shell 统一 danger 着色。 */
  title: string;
  titleDanger: boolean;
  /** 标题字号，默认 13（旧 PromptEditor 值）；文件屏传 14 还原旧默认字号。 */
  titleFontSize?: number;
  /** 提供时标题区渲染为可点按（收起键盘）变体，如文件编辑聚焦态。 */
  titlePress?: {
    testID?: string;
    onPress: () => void;
  };
  /** 不提供则不渲染右侧编辑/预览切换（如文件编辑只读分支）。 */
  toggle?: {
    testID?: string;
    accessibilityLabel?: string;
    previewMode: boolean;
    onPress: () => void;
  };
  /** toolbar 与 SegmentedControl 之间的附加行（如更新时间/字数统计）。 */
  toolbarExtra?: React.ReactNode;
  /** 预览态渲染档位（markdown/文本），两屏共用同一组选项。 */
  segmented: {
    options: readonly SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
  };
  previewMode: boolean;
  preview: React.ReactNode;
  editor: React.ReactNode;
};

export function EditorScreenShell<T extends string>({
  tokens,
  toolbarBorderColor,
  save,
  title,
  titleDanger,
  titleFontSize = 13,
  titlePress,
  toggle,
  toolbarExtra,
  segmented,
  previewMode,
  preview,
  editor,
}: EditorScreenShellProps<T>) {
  const titleColor = titleDanger ? tokens.danger : tokens.textSecondary;

  const body = (
    <>
      <View style={[styles.toolbar, {borderBottomColor: toolbarBorderColor}]}>
        <Pressable
          testID={save.testID}
          accessibilityLabel={save.accessibilityLabel}
          style={styles.toolbarBtn}
          onPress={save.onPress}
          disabled={save.disabled}
        >
          <Text
            style={[
              styles.toolbarText,
              {color: save.disabled ? tokens.textSecondary : tokens.primary},
            ]}
          >
            {save.label}
          </Text>
        </Pressable>
        {titlePress ? (
          <Pressable
            testID={titlePress.testID}
            style={styles.toolbarTitle}
            onPress={titlePress.onPress}
            accessibilityRole="button"
            accessibilityLabel="收起键盘"
          >
            <Text
              style={[
                styles.toolbarTitleText,
                {color: titleColor, fontSize: titleFontSize},
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
          </Pressable>
        ) : (
          <Text
            style={[
              styles.toolbarTitle,
              styles.toolbarTitleText,
              {color: titleColor, fontSize: titleFontSize},
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
        )}
        {toggle ? (
          <Pressable
            testID={toggle.testID}
            accessibilityLabel={toggle.accessibilityLabel}
            style={styles.toolbarBtn}
            onPress={toggle.onPress}
          >
            <Text
              style={[
                styles.toolbarText,
                {
                  color: toggle.previewMode
                    ? tokens.primary
                    : tokens.textSecondary,
                },
              ]}
            >
              {toggle.previewMode ? '编辑' : '预览'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {toolbarExtra}
      {previewMode ? (
        <SegmentedControl
          options={segmented.options}
          value={segmented.value}
          onChange={segmented.onChange}
          tokens={tokens}
        />
      ) : null}
      {previewMode ? (
        /* WebView owns scroll — no outer ScrollView (avoids nested scroll + height bugs). */
        <View style={[styles.preview, {backgroundColor: tokens.surface}]}>
          {preview}
        </View>
      ) : (
        editor
      )}
    </>
  );

  const rootStyle = [styles.root, {backgroundColor: tokens.background}];

  // 预览无软键盘；编辑态 Android 抬升裁切，iOS 仍用 KAV padding。
  if (previewMode) {
    return <View style={rootStyle}>{body}</View>;
  }

  if (Platform.OS === 'android') {
    return (
      <View style={rootStyle}>
        <AndroidKeyboardClipBody>{body}</AndroidKeyboardClipBody>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={rootStyle} behavior="padding" automaticOffset>
      {body}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
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
  },
  toolbarTitleText: {fontSize: 13, textAlign: 'center'},
  toolbarText: {fontSize: 14, fontWeight: '600'},
  preview: {flex: 1, minHeight: 0, padding: 12},
});
