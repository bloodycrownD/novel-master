/**
 * Android 弹窗键盘避让：返回一个 `useAnimatedStyle` 产生的样式，
 * 供 `Animated.View` 包裹弹窗面板时使用，靠 translateY 把面板上移。
 *
 * 为什么需要这个：`react-native-keyboard-controller` 的 `KeyboardAvoidingView`
 * 在 Android 上 `behavior={undefined}` 等于啥也不干，不像 RN 原生那个会 fallback 到 resize。
 * 所以 Android 分支要自己接 `useReanimatedKeyboardAnimation` + `Animated.View` 的 translateY。
 *
 * fraction 区分两类弹窗：
 * - 居中弹窗（如 `MessageEditModal` / `TextPromptModal`）：面板在屏幕中央，
 *   上移键盘高度的一半就够露出输入框，又不会顶到屏幕顶部，传 0.5。
 * - 底部对齐 sheet（如 `DirectoryRuleSheet` / `AddModelModal`）：面板紧贴屏幕底部，
 *   键盘弹起后只移一半还是会盖住大半面板，得移整个键盘高度才能贴到键盘上方，传 1。
 *
 * iOS 不走这个 hook，沿用各自的 `KeyboardAvoidingView` 的 `behavior="padding"` 分支。
 */
import {useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import {useAnimatedStyle} from 'react-native-reanimated';

/**
 * @param fraction translateY 占键盘高度的比例。居中弹窗传 0.5，底部 sheet 传 1。
 */
export function useAndroidModalKeyboardAvoid(fraction: 0.5 | 1 = 0.5) {
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  // hook 返回的 height 在键盘弹起时为负值（如键盘高 300 时值为 -300），
  // 收起时为 0。Math.min(0, ...) 兜底防止正值（理论上不会出现）把面板往下推。
  const panelAvoidStyle = useAnimatedStyle(() => {
    return {
      transform: [{translateY: Math.min(0, keyboardHeightSV.value) * fraction}],
    };
  }, [keyboardHeightSV, fraction]);
  return panelAvoidStyle;
}
