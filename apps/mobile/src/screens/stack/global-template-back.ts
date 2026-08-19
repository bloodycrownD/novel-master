/**
 * GlobalTemplateScreen 的 beforeRemove 拦截判定。
 *
 * 侧滑手势与返回按钮触发的路由移除动作 type 为 "POP"（见
 * @react-navigation/routers 的 CommonActions），只有这类「用户返回」
 * 动作才应被转成文件浏览器的逐级上翻；RESET / POP_TO_TOP 等清栈
 * 导航（如登出清栈）必须放行，否则会被吞成「上翻一级」。
 */

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
