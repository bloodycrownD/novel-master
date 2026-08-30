/**
 * 弹窗/底部 sheet 统一骨架（cr-fix-spec comp-rest/C-1）：
 * AppModal + 透明遮罩（按压关闭）+ panel 定位（center 居中卡片 / bottom 贴底
 * sheet / left 左侧抽屉）+ 平台键盘避让分支。
 *
 * 键盘避让策略 keyboardAvoid：
 * - none：无输入的弹窗（菜单、日历、选择列表），两个平台都不避让。
 * - translate：矮面板位移避让。居中弹窗传 fraction 0.5（上移半键盘高度，
 *   露出输入框又不顶到屏幕顶部），贴底矮 sheet 传 1（整体上移键盘高度）。
 * - adaptive：贴底高面板「上移 + maxHeight 收缩」，传 maxHeightRatio；
 *   FormOverlayHost 体系（无 AppModal/KAV 外壳）用 standalone + iosTranslateY。
 *
 * iOS 有输入时走 KeyboardAvoidingView padding 分支；Android 上
 * react-native-keyboard-controller 的 KeyboardAvoidingView behavior={undefined}
 * 等于啥也不干，所以 Android 全靠 hook 的 translateY（挂在本组件的 panel 上）。
 */
import React, {type ReactNode} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {AppModal} from './AppModal';
import {useTheme} from '../../theme/ThemeProvider';
import {useAndroidModalKeyboardAvoid} from '../../hooks/useAndroidModalKeyboardAvoid';
import {useAdaptiveKeyboardSheetStyle} from '../../hooks/useAdaptiveKeyboardSheetStyle';

export type ModalShellVariant = 'center' | 'bottom' | 'left';

export type ModalShellKeyboardAvoid =
  | {kind: 'none'}
  | {kind: 'translate'; fraction: 0.5 | 1}
  | {
      kind: 'adaptive';
      maxHeightRatio: number;
      /** iOS 是否也由 hook translateY（默认 false：AppModal 体系 iOS 外层已有 KAV）。 */
      iosTranslateY?: boolean;
    };

type Props = {
  visible: boolean;
  onClose: () => void;
  variant?: ModalShellVariant;
  animationType?: 'none' | 'slide' | 'fade';
  statusBarTranslucent?: boolean;
  keyboardAvoid?: ModalShellKeyboardAvoid;
  /** iOS KAV 的 keyboardVerticalOffset（居中弹窗需要 24 顶开状态栏留白）。 */
  keyboardVerticalOffset?: number;
  /** 遮罩不透明度，默认 0.4；BottomSheetMenu 这类深遮罩传 0.55。 */
  backdropOpacity?: number;
  /** 面板样式（圆角 / padding / 宽度 / maxHeight 等）。 */
  panelStyle?: StyleProp<ViewStyle>;
  /** 定位容器样式（如居中弹窗的水平留白）。 */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * 只渲染遮罩 + 面板骨架（不包 AppModal 与 KAV），供 FormOverlayHost 这类
   * 自管宿主的场景嵌入；调用方自行控制挂载/卸载，visible 此时被忽略。
   */
  standalone?: boolean;
  children: ReactNode;
};

export function ModalShell({
  visible,
  onClose,
  variant = 'bottom',
  animationType = 'slide',
  statusBarTranslucent,
  keyboardAvoid = {kind: 'none'},
  keyboardVerticalOffset = 0,
  backdropOpacity = 0.4,
  panelStyle,
  containerStyle,
  standalone = false,
  children,
}: Props) {
  const {tokens} = useTheme();
  // 两个避让 hook 都无条件调用（hooks 规则），按策略选用其一；
  // 未选用的那份样式不挂到 panel 上，无副作用。
  const translateAvoid = useAndroidModalKeyboardAvoid(
    keyboardAvoid.kind === 'translate' ? keyboardAvoid.fraction : 0.5,
  );
  const adaptiveAvoid = useAdaptiveKeyboardSheetStyle(
    keyboardAvoid.kind === 'adaptive' ? keyboardAvoid.maxHeightRatio : 0.75,
    {
      iosTranslateY:
        keyboardAvoid.kind === 'adaptive'
          ? (keyboardAvoid.iosTranslateY ?? false)
          : false,
    },
  );
  const avoidStyle =
    keyboardAvoid.kind === 'translate'
      ? translateAvoid
      : keyboardAvoid.kind === 'adaptive'
        ? adaptiveAvoid
        : undefined;

  // panel 挂 responder 吞掉落在面板空白处的触摸，避免穿透到遮罩误关闭。
  const panel = (
    <Animated.View
      style={[
        styles.panel,
        {backgroundColor: tokens.surface},
        avoidStyle,
        panelStyle,
      ]}
      onStartShouldSetResponder={() => true}>
      {children}
    </Animated.View>
  );

  const containerStyleList = [
    variant === 'center' ? styles.center : styles.bottom,
    containerStyle,
  ];

  // left 抽屉：遮罩是 drawer 右侧的正常流 Pressable（不能用 absoluteFill，
  // 否则会垫在 drawer 下面、点 drawer 空白处穿透关闭）。
  const content = (
    <View style={containerStyleList}>
      {variant === 'left' ? null : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="关闭"
          accessibilityRole="button"
        />
      )}
      {panel}
      {variant === 'left' ? (
        <Pressable
          style={styles.leftBackdrop}
          onPress={onClose}
          accessibilityLabel="关闭"
          accessibilityRole="button"
        />
      ) : null}
    </View>
  );

  // iOS：有输入且未由 adaptive hook 接管位移时，外层包 KAV padding 分支。
  const useKav =
    keyboardAvoid.kind !== 'none' &&
    !(keyboardAvoid.kind === 'adaptive' && keyboardAvoid.iosTranslateY);

  const rootStyle = [
    styles.root,
    {backgroundColor: `rgba(0,0,0,${backdropOpacity})`},
  ];

  if (standalone) {
    return <View style={rootStyle}>{content}</View>;
  }

  return (
    <AppModal
      visible={visible}
      transparent
      animationType={animationType}
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={onClose}>
      {Platform.OS === 'ios' && useKav ? (
        <KeyboardAvoidingView
          behavior="padding"
          style={rootStyle}
          keyboardVerticalOffset={keyboardVerticalOffset}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        <View style={rootStyle}>{content}</View>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // 遮罩色放 root（而非定位容器）：KAV 加的 paddingBottom 区域也属于 root 的
  // padding box，会被 backgroundColor 覆盖，键盘弹起后底部不透白条。
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  panel: {},
  leftBackdrop: {
    flex: 1,
  },
});
