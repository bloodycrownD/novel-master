/**
 * P0-3：renderRows UI 刷新注册门面（预留）。
 * 本步仅提供 register 钩子；现网拼串仍在 row-render.ts，后续 Step 由 main 注册 Preact 实现。
 */
export type RenderRowsView = () => void;

let _renderRowsView: RenderRowsView | null = null;

/** 由 main 注册 Preact（或其它）行列表刷新实现。 */
export function registerRenderRows(fn: RenderRowsView): void {
  _renderRowsView = fn;
}

/**
 * 调用已注册实现；未注册时返回 false（调用方继续走现网拼串路径）。
 * 后续 Step 接线后由 renderRows 门面统一走此路径。
 */
export function invokeRegisteredRenderRows(): boolean {
  if (!_renderRowsView) return false;
  _renderRowsView();
  return true;
}
