/**
 * GlobalTemplateScreen 的 beforeRemove 拦截判定。
 *
 * 侧滑手势与返回按钮触发的路由移除动作 type 为 "POP"（见
 * @react-navigation/routers 的 CommonActions），只有这类「用户返回」
 * 动作才应被转成文件浏览器的逐级上翻；RESET / POP_TO_TOP 等清栈
 * 导航（如登出清栈）必须放行，否则会被吞成「上翻一级」。
 */

/** 判定窗口（毫秒）：本屏刚被聚焦后短时间内到达的 POP 视为手势残余。 */
export const GHOST_POP_WINDOW_MS = 350;

/** beforeRemove 拦截判定的输入：导航动作类型 + 当前是否在子目录。 */
export type BackInterceptInput = {
  actionType: string;
  canGoUp: boolean;
};

/**
 * 是否把本次 beforeRemove 拦截为逐级上翻：
 * 仅「POP 类返回动作 且 处于子目录」时拦截，其余（根目录返回、
 * 清栈导航）一律放行。
 */
export function shouldInterceptBackRemove({
  actionType,
  canGoUp,
}: BackInterceptInput): boolean {
  return actionType === 'POP' && canGoUp;
}

/**
 * 是否为「幽灵 POP」（手势残余，须吞掉但不作任何处理）。
 *
 * 背景：native-stack 的侧滑是 interactive 手势，从文件详情 pop 回
 * 本屏时，若 JS 线程被预览渲染阻塞，手势结束事件可能被重放为第二
 * 次 POP——本屏在根目录时会因此被连坐退出（浏览器整个消失）。
 * 判定：本屏刚被聚焦（如刚从详情页返回）后 GHOST_POP_WINDOW_MS 内
 * 到达的 POP 属手势残余：preventDefault 吞掉，既不退出也不上翻。
 * 用户随后的真实侧滑（必然晚于窗口）不受影响。
 */
export function isGhostPop({
  actionType,
  focusedAtMs,
  nowMs,
}: {
  actionType: string;
  focusedAtMs: number;
  nowMs: number;
}): boolean {
  return (
    actionType === 'POP' && nowMs - focusedAtMs < GHOST_POP_WINDOW_MS
  );
}
