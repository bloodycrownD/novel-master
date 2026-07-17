import { state } from './state';
import { post } from './bridge';
import { closeContextMenu } from './menu';
import { renderRows } from './row-render';
import { requestLoadOlder } from './scroll';
/**
 * #rows 点击：折叠开关、打开工具文件、加载更早等。
 */
export function onRowsClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target || !target.closest) return;
  const actionEl = target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.getAttribute('data-action');
  if (action === 'close-menu') {
    closeContextMenu(true);
    return;
  }
  if (action === 'menu-action') {
    const messageId = actionEl.getAttribute('data-message-id');
    const menuAction = actionEl.getAttribute('data-menu-action');
    closeContextMenu(true);
    if (messageId && menuAction) {
      post('messageMenuAction', { messageId: messageId, action: menuAction });
    }
    return;
  }
  if (action === 'toggle-thinking') {
    const key = actionEl.getAttribute('data-thinking-key');
    if (key) {
      state.thinkingExpanded[key] = !state.thinkingExpanded[key];
      renderRows();
    }
    return;
  }
  if (action === 'toggle-tool-group') {
    const tgKey = actionEl.getAttribute('data-tool-group-key');
    if (tgKey) {
      state.toolGroupExpanded[tgKey] = !state.toolGroupExpanded[tgKey];
      renderRows();
    }
    return;
  }
  if (action === 'toggle-attach-group') {
    const agKey = actionEl.getAttribute('data-attach-group-key');
    if (agKey) {
      state.attachGroupExpanded[agKey] = !state.attachGroupExpanded[agKey];
      renderRows();
    }
    return;
  }
  if (action === 'open-tool-file') {
    const path = actionEl.getAttribute('data-path');
    if (path) post('openToolFile', { path: path });
    return;
  }
  if (action === 'load-older') {
    requestLoadOlder();
  }
}
