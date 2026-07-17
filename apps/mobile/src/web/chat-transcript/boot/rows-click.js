/**
 * #rows 点击：折叠开关、打开工具文件、加载更早等。
 */
  function onRowsClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action === 'close-menu') {
      closeContextMenu(true);
      return;
    }
    if (action === 'menu-action') {
      var messageId = actionEl.getAttribute('data-message-id');
      var menuAction = actionEl.getAttribute('data-menu-action');
      closeContextMenu(true);
      if (messageId && menuAction) {
        post('messageMenuAction', { messageId: messageId, action: menuAction });
      }
      return;
    }
    if (action === 'toggle-thinking') {
      var key = actionEl.getAttribute('data-thinking-key');
      if (key) {
        state.thinkingExpanded[key] = !state.thinkingExpanded[key];
        renderRows();
      }
      return;
    }
    if (action === 'toggle-tool-group') {
      var tgKey = actionEl.getAttribute('data-tool-group-key');
      if (tgKey) {
        state.toolGroupExpanded[tgKey] = !state.toolGroupExpanded[tgKey];
        renderRows();
      }
      return;
    }
    if (action === 'toggle-attach-group') {
      var agKey = actionEl.getAttribute('data-attach-group-key');
      if (agKey) {
        state.attachGroupExpanded[agKey] = !state.attachGroupExpanded[agKey];
        renderRows();
      }
      return;
    }
    if (action === 'open-tool-file') {
      var path = actionEl.getAttribute('data-path');
      if (path) post('openToolFile', { path: path });
      return;
    }
    if (action === 'load-older') {
      requestLoadOlder();
    }
  }
