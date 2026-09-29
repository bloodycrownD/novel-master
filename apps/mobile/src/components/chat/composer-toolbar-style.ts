/**
 * 底部动作行的圆钮共享样式（capsule/C-1）。
 *
 * 此前同一份「36 圆钮 + 细描边」被逐字复制在三处：ChatComposer.styles.toolBtn
 * （@ / $ / ⛶）、PromptEditorScreen.styles.actionBtn（@ / $），以及视觉基线本身。
 * 复制粘贴的直接代价是：⛶ 触达尺寸从 28×28 调到 36×36 时只改了一处，全屏屏
 * 与内联输入框的按钮就分叉了。
 *
 * 抽出来后两处同引（改动本文件即同时生效）。注意：`borderColor` 由各自 token 在
 * 渲染处叠加（`[composerToolBtnStyle, {borderColor: tokens.border}]`），描边宽度
 * 本身用 hairline 与原实现一致。
 */
import {StyleSheet} from 'react-native';

/** 引用类工具按钮（@ / $ / ⛶ 共用）：36 见方圆钮 + hairline 描边 + 内容居中。 */
export const composerToolBtnStyle = StyleSheet.create({
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
}).toolBtn;
