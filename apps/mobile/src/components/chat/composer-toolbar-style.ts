/**
 * 底部动作行的圆钮共享样式（capsule/C-1）。
 *
 * 此前同一份「36 圆钮 + 细描边」被逐字复制在两处：ChatComposer 工具栏的
 * styles.toolBtn（@ / $ / ⛶）与 PromptEditorScreen 底排的 styles.actionBtn
 * （@ / $）。复制粘贴的直接代价是：改一处另一处就分叉（ fullscreen ⛶ 曾从
 * 28×28 调到 36×36 对齐内联，靠的是手工同步 + T-FS1 样式相等断言兜底）。
 *
 * 现在两处同引本常量（改动本文件即同时生效）。注意：`borderColor` 由各自
 * token 在渲染处叠加（`[composerToolBtnStyle, {borderColor: tokens.border}]`），
 * 描边宽度本身用 hairline 与原实现一致。
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
