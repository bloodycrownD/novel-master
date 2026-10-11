/**
 * 发送/终止钮状态机（composer-native-2026-10 Step 4 · J 组语义，RN 版）。
 *
 * 逻辑原样迁自 `src/web/chat-conversation/webview/dock.ts` 的
 * `resolveSendButtonState`——差别只在输入面：web 吃整份 `composerState`，
 * RN 侧组件只收上层算好的两个布尔（门闩不在此重复实现，spec T-NC7）：
 * - `canSend` = `!sendDisabled`（`resolveComposerSendIntent` 的产物，controller 算好）；
 * - `running` = 当前会话 run 活跃。
 *
 * 三分支与优先级逐字对齐 web：`disabled → danger → primary`，`disabled` 优先——
 * running 且不可发送时按钮仍呈现禁用形态（web 同款），点击动作随 running 切换
 * `send ↔ terminate`。RN 侧不再从 state 里读 `action` 之外的东西：背景色映射
 * （border/ danger / primary）由组件按主题 token 渲染，本文件只管状态。
 */
import type {ConversationDockAction} from '../ChatConversationBridge';

/** 发送/终止钮形态：canSend=false 走 disabled，running 走 danger，否则 primary。 */
export type SendButtonState = {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly variant: 'disabled' | 'danger' | 'primary';
  /** 上行动作（running 时是「终止」，否则「发送」）。 */
  readonly action: ConversationDockAction;
};

export function resolveSendButtonState(input: {
  readonly canSend: boolean;
  readonly running: boolean;
}): SendButtonState {
  return {
    disabled: !input.canSend,
    running: input.running,
    variant: !input.canSend ? 'disabled' : input.running ? 'danger' : 'primary',
    action: input.running ? 'terminate' : 'send',
  };
}
