/**
 * Scrollable form screen with optional sticky footer.
 */
import React, {type ReactNode} from 'react';
import {Platform, ScrollView, StyleSheet, View} from 'react-native';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import type {ThemeTokens} from '@/theme/tokens';
import {FormOverlayProvider} from './FormOverlayHost';

type Props = {
  tokens: ThemeTokens;
  children: ReactNode;
  footer?: ReactNode;
  /** Disable scroll while a modal/sheet is open to avoid background bleed. */
  scrollEnabled?: boolean;
};

/**
 * Android：与聊天页/文件编辑页同款——裁切窗口用 marginBottom 收缩键盘高度，
 * 内容区（flex:1）跟着缩到键盘以上。不能只 translateY：ScrollView 高度不变的话
 * 顶部会被 overflow:hidden 裁掉、底部输入项又顶在键盘下面够不着。footer 放在
 * keyboardLiftBody 内、ScrollView 之后，这样它跟内容区一起随键盘抬起。
 */
function AndroidKeyboardFormBody({
  children,
  footer,
  scrollEnabled,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollEnabled: boolean;
}) {
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  // hook 返回的 height 是负数（键盘高 300 时值为 -300），取反得到正的键盘高度，
  // 作为 marginBottom 让裁切窗口底部收紧，body 跟着缩到键盘以上。
  const clipStyle = useAnimatedStyle(() => {
    const kb = -keyboardHeightSV.value;
    return {marginBottom: kb};
  }, [keyboardHeightSV]);

  return (
    <Animated.View style={[styles.keyboardClip, clipStyle]}>
      <View style={styles.keyboardLiftBody}>
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer}
      </View>
    </Animated.View>
  );
}

export function ScreenFormLayout({
  tokens,
  children,
  footer,
  scrollEnabled = true,
}: Props) {
  const rootStyle = [styles.root, {backgroundColor: tokens.background}];

  if (Platform.OS === 'android') {
    return (
      <FormOverlayProvider>
        <View style={rootStyle}>
          <AndroidKeyboardFormBody
            scrollEnabled={scrollEnabled}
            footer={footer}
          >
            {children}
          </AndroidKeyboardFormBody>
        </View>
      </FormOverlayProvider>
    );
  }

  return (
    <FormOverlayProvider>
      <KeyboardAvoidingView
        style={rootStyle}
        behavior="padding"
        automaticOffset
      >
        <ScrollView
          scrollEnabled={scrollEnabled}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </FormOverlayProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  scroll: {paddingTop: 16, paddingBottom: 24},
  keyboardClip: {flex: 1, minHeight: 0, overflow: 'hidden'},
  keyboardLiftBody: {flex: 1, minHeight: 0},
});
