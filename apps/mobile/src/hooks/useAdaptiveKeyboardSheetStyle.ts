/**
 * 底部高面板键盘自适应样式（公共 hook）。
 *
 * 适用场景：贴屏幕底部的高面板（maxHeight 占屏 75% / 85%）且内含输入框——
 * 键盘弹起时不能只做位移（面板顶部/标题会被顶出屏幕），要在整体上移的同时
 * 让 maxHeight 随键盘收缩：面板高度不超过屏幕剩余空间，底部贴键盘顶、顶部不出屏。
 * topMargin 默认 0（用户拍板「要么全遮要么不遮」）：键盘弹起时面板占据整个
 * 可视区域、顶部贴屏顶（页面标题整个被盖），不留余量，避免遮一半的尴尬。
 *
 * 与 useAndroidModalKeyboardAvoid 的分工：那个只做 translateY（fraction 语义，
 * 居中矮弹窗上移半高用，如 TextPromptModal / EditModelModal），保持不动；
 * 本 hook 是「位移 + maxHeight 收缩」二合一，给底部高面板用。
 *
 * 两套渲染体系的接入方式相同——面板容器换成 Animated.View 后把返回样式挂上去：
 * - AppModal 体系（FetchModelsSheet / DirectoryRuleSheet / NewSkillModal）：
 *   iOS 外层已有 KeyboardAvoidingView padding 分支，本 hook 的 translateY 仅
 *   Android 生效，maxHeight 收缩两平台都生效。
 * - FormOverlayHost 体系（ToolPolicyPicker）：渲染层是普通 View 无任何避让，
 *   全靠本 hook 在 sheet 自身处理。
 */
import {Platform, useWindowDimensions} from 'react-native';
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {useAnimatedStyle} from 'react-native-reanimated';

export type Options = {
  /** 顶部余量（px），默认 0：面板贴屏顶，全遮页面标题。 */
  topMargin?: number;
  /** maxHeight 收缩下限（px），默认 160，防止键盘比屏高还高时面板被压没。 */
  minPanelHeight?: number;
};

/**
 * @param maxHeightRatio 静态上限占屏比例（0.75 / 0.85），键盘未弹起时的面板高度上限。
 */
export function useAdaptiveKeyboardSheetStyle(
  maxHeightRatio: number,
  opts?: Options,
) {
  const topMargin = opts?.topMargin ?? 0;
  const minPanelHeight = opts?.minPanelHeight ?? 160;
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const {height: screenH} = useWindowDimensions();
  return useAnimatedStyle(
    () => {
      // hook 返回的 height 键盘弹起时为负值，Math.min(0, ...) 兜底防正值下推。
      const kb = Math.min(0, keyboardHeightSV.value);
      const available = screenH + kb - topMargin;
      return {
        ...(Platform.OS === 'android' ? {transform: [{translateY: kb}]} : {}),
        maxHeight: Math.max(
          minPanelHeight,
          Math.min(screenH * maxHeightRatio, available),
        ),
      };
    },
    [keyboardHeightSV, screenH, maxHeightRatio, topMargin, minPanelHeight],
  );
}
