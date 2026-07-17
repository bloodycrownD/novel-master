/**
 * HTML 转义工具（供 stream-markdown 与行渲染共用）。
 */
  function escapeHtml(s) {
    return escapeHtmlRaw(decodeLiteralHtmlEntities(s));
  }

  function escapeHtmlRaw(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
