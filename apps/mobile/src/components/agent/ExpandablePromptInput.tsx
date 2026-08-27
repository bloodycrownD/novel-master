/**
 * 提示词内联输入包装（UX 简化）：内联编辑器由调用方以 maxHeight 限 5 行
 * （超出部分输入框内部滚动，仍可正常输入），右侧常驻「全屏编辑」小按钮
 * 跳转 PromptEditor 全屏页（保存才回填，取消不动）。无折叠态与测量逻辑。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  /** 渲染内联编辑器（宏能力保留；限高样式由调用方传给输入框）。 */
  renderInline: () => React.ReactNode;
  /** 打开全屏编辑页（保存才回填，取消不动）。 */
  openEditor: () => void;
  testID?: string;
};

export function ExpandablePromptInput({renderInline, openEditor, testID}: Props) {
  const {tokens} = useTheme();

  const handleOpenPress = useCallback(() => {
    openEditor();
  }, [openEditor]);

  return (
    <View testID={testID} style={styles.root}>
      <View style={styles.inputWrap}>{renderInline()}</View>
      <Pressable
        testID={testID ? `${testID}-fullscreen` : undefined}
        onPress={handleOpenPress}
        accessibilityLabel="全屏编辑"
        style={[
          styles.openBtn,
          {
            backgroundColor: tokens.bgSecondary,
            borderColor: tokens.borderLight,
          },
        ]}
        hitSlop={8}>
        <Text style={[styles.openGlyph, {color: tokens.textSecondary}]}>
          ⤢
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  inputWrap: {flex: 1, minWidth: 0},
  openBtn: {
    width: 32,
    height: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  openGlyph: {fontSize: 16, lineHeight: 20},
});
