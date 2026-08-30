/**
 * Android 键盘裁切容器（screens/C-2 收敛，四处逐字复制提取）。
 *
 * 与聊天页 KeyboardStickyView 同源的动画 height：裁切窗口用 marginBottom 收缩
 * 键盘高度，内容区（flex:1）跟着缩到键盘以上。关键不能只靠 translateY——body
 * 是 flex:1 不会自动缩，平移后顶部会被外层 overflow:hidden 裁掉，滚不回去也
 * 编辑不了；这里直接收缩裁切窗口高度，内容区照常滚动、输入框贴在键盘上方。
 *
 * 仅 Android 使用；iOS 走 react-native-keyboard-controller 的
 * KeyboardAvoidingView behavior="padding" 路径，不要套本组件。
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';

export function AndroidKeyboardClipBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  // hook 返回的 height 是负数（键盘高 300 时值为 -300），取反得到正的键盘高度。
  const clipStyle = useAnimatedStyle(() => {
    return {marginBottom: -keyboardHeightSV.value};
  }, [keyboardHeightSV]);

  return (
    <Animated.View style={[styles.keyboardClip, clipStyle]}>
      <View style={styles.keyboardLiftBody}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  keyboardClip: {flex: 1, minHeight: 0, overflow: 'hidden'},
  keyboardLiftBody: {flex: 1, minHeight: 0},
});
