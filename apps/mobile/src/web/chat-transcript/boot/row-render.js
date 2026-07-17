/**
 * 消息行 / 思考 / 附件 / 助手气泡 / 用户 VFS 行渲染。
 */
  function thinkingBodyInner(text, thinkingHtml) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if (state.flags.richText && thinkingHtml) {
      return thinkingHtml;
    }
    return escapeHtml(trimmed);
  }

  function renderThinkingSection(text, key, expanded, thinkingHtml, showDividerBelow) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    var chevron = expanded ? '▼' : '▶';
    var richClass = state.flags.richText && thinkingHtml ? ' rich' : '';
    var bodyClass = 'thinking-body' + richClass;
    if (expanded && showDividerBelow) {
      bodyClass += ' thinking-body-divided';
    }
    var body = expanded
      ? '<div class="' + bodyClass + '">' + thinkingBodyInner(text, thinkingHtml) + '</div>'
      : '';
    return (
      '<div class="thinking-section" data-thinking-key="' + escapeHtml(key) + '">' +
      '<div class="thinking-header" data-action="toggle-thinking" data-thinking-key="' + escapeHtml(key) + '">' +
      '<span class="thinking-title">思考过程</span>' +
      '<span class="thinking-chevron">' + chevron + '</span></div>' + body + '</div>'
    );
  }

  function attachmentChipLabel(a) {
    if (a.source === 'user_ops') {
      return a.name || '';
    }
    var path = a.path || a.name || '';
    if (a.type === 'dir') {
      return '📁' + path;
    }
    return '📄' + path;
  }

  function attachmentSourceLabel(a) {
    if (a.source === 'workplace') {
      return '工作区';
    }
    if (a.source === 'user_ops') {
      return '';
    }
    return a.type === 'dir' ? '目录' : '文件';
  }

  /** 对齐工具调用组：可折叠 header + surface 卡片列表。 */
  function renderAttachGroupSection(attachments, key, expanded, showDividerAbove) {
    if (!attachments || attachments.length === 0) {
      return '';
    }
    var isExpanded = !!expanded;
    var chevron = isExpanded ? '▼' : '▶';
    var divided = showDividerAbove ? ' attach-group-divided-above' : '';
    var html =
      '<div class="tool-group-section attach-group-section' +
      divided +
      '" data-attach-group-key="' +
      escapeHtml(key) +
      '">' +
      '<div class="tool-group-header" data-action="toggle-attach-group" data-attach-group-key="' +
      escapeHtml(key) +
      '">' +
      '<span class="tool-group-title">消息附件 (' +
      attachments.length +
      ')</span>' +
      '<span class="tool-group-chevron">' +
      chevron +
      '</span></div>';
    if (isExpanded) {
      html += '<div class="tool-group-items">';
      for (var ai = 0; ai < attachments.length; ai++) {
        var a = attachments[ai];
        html +=
          '<div class="tool-group-item tool-card attach-card">' +
          '<div class="tool-header">' +
          '<span class="tool-name">' +
          escapeHtml(attachmentChipLabel(a)) +
          '</span>' +
          (attachmentSourceLabel(a)
            ? '<span class="tool-status success">' +
              escapeHtml(attachmentSourceLabel(a)) +
              '</span>'
            : '') +
          '</div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderAssistantBubbleInner(
    text,
    textHtml,
    thinking,
    thinkingKey,
    thinkingExpanded,
    thinkingHtml,
    tools,
    toolGroupKey,
    toolGroupExpanded,
    showToolInvoking
  ) {
    var html = '';
    var hasThinking = !!(thinking && String(thinking).trim());
    var hasTools = !!(tools && tools.length > 0);
    var hasInvoking = !!showToolInvoking;
    var hasText = !!(text && String(text).trim());
    if (hasThinking) {
      html += renderThinkingSection(
        thinking,
        thinkingKey,
        thinkingExpanded,
        thinkingHtml,
        hasText || hasTools || hasInvoking
      );
    }
    if (hasText) {
      var richBubble = state.flags.richText && textHtml ? ' rich' : '';
      var inner = textHtml || escapeHtml(text || '');
      html += '<div class="bubble-body' + richBubble + '">' + inner + '</div>';
    } else if (hasThinking) {
      // WHY: 仅有 thinking、正文为空时预置空 .bubble-body，供后续 text 增量挂载。
      var richShellBubble = state.flags.richText && textHtml ? ' rich' : '';
      html += '<div class="bubble-body' + richShellBubble + '" data-text-shell="1"></div>';
    }
    if (hasInvoking) {
      html += renderToolInvokingBar();
    }
    if (hasTools) {
      html += renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false);
    }
    return html;
  }

  function renderToolOnlyBubble(tools, toolGroupKey, toolGroupExpanded, options) {
    var bubbleClass = 'bubble bubble--fill-width';
    if (options && options.bubbleExtraClass) {
      bubbleClass += ' ' + options.bubbleExtraClass;
    }
    var sectionOpts = options && options.groupTitle
      ? { groupTitle: options.groupTitle }
      : undefined;
    return '<div class="' + bubbleClass + '">' +
      renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false, sectionOpts) +
      '</div>';
  }

  function renderUserVfsTurnRow(row) {
    if (!row.tools || row.tools.length === 0) {
      return '';
    }
    var hidden = row.hidden ? ' hidden' : '';
    var html = '<div class="row message user vfs-turn-row' + hidden + '" data-id="' + escapeHtml(row.id) + '">';
    var toolGroupKey = 'vfs-turn:' + row.id;
    var toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
    html += renderToolOnlyBubble(
      row.tools,
      toolGroupKey,
      toolGroupExpanded,
      {
        groupTitle: '用户操作 (' + row.tools.length + ')',
        bubbleExtraClass: 'vfs-turn-bubble',
      },
    );
    html += '</div>';
    return html;
  }

  function renderRow(row) {
    if (row.kind === 'user_vfs_turn') {
      return renderUserVfsTurnRow(row);
    }
    if (row.kind === 'message') {
      return renderMessageRow(row);
    }
    return '';
  }

  function renderUserBubbleContent(text) {
    // VFS 操作卡只走结构化 row.kind === 'user_vfs_turn'；正文不再兜底解析 <action>
    return escapeHtml(text);
  }

  function renderMessageRow(row) {
    var role = row.role === 'user' ? 'user' : 'assistant';
    var hidden = row.hidden ? ' hidden' : '';
    var thinkingKey = 'msg:' + row.id;
    var thinkingExpanded = !!state.thinkingExpanded[thinkingKey];
    var html = '<div class="row message ' + role + hidden + '" data-id="' + escapeHtml(row.id) + '">';
    if (role === 'user') {
      var attachments = row.attachments || [];
      var hasAttach = attachments.length > 0;
      var hasText = !!(row.text && String(row.text).length > 0);
      if (hasAttach || hasText) {
        if (hasAttach) {
          // 正文在上、附件组在下，合进同一条 bubble
          var attachKey = 'attach:' + row.id;
          var attachExpanded = !!state.attachGroupExpanded[attachKey];
          html +=
            '<div class="bubble bubble--fill-width bubble--user-compose">' +
            (hasText
              ? '<div class="bubble-body">' +
                renderUserBubbleContent(row.text) +
                '</div>'
              : '') +
            renderAttachGroupSection(
              attachments,
              attachKey,
              attachExpanded,
              hasText,
            ) +
            '</div>';
        } else {
          html +=
            '<div class="bubble">' +
            renderUserBubbleContent(row.text) +
            '</div>';
        }
      }
    } else if (row.thinking || row.text || (row.tools && row.tools.length > 0)) {
      var toolGroupKey = 'msg:' + row.id;
      var toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
      html += '<div class="bubble' + assistantBubbleExtraClasses(row.textHtml, row.tools, row.text, row.thinking) + '">' +
        renderAssistantBubbleInner(
          row.text,
          row.textHtml,
          row.thinking,
          thinkingKey,
          thinkingExpanded,
          row.thinkingHtml,
          row.tools,
          toolGroupKey,
          toolGroupExpanded,
          false
        ) +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderLoadOlder() {
    if (!state.hasMore) return '';
    return '<button type="button" class="load-older" data-action="load-older">加载更早消息</button>';
  }

  function renderEmptyState() {
    var hasStream = !!(state.stream.text || state.stream.thinking || state.stream.toolInvoking);
    if (state.rows.length > 0 || hasStream) return '';
    return '<div class="empty-state">暂无消息</div>';
  }

  function flagsEqual(a, b) {
    return (
      a.richText === b.richText &&
      a.menuDisabled === b.menuDisabled
    );
  }

  function renderRows() {
    var list = document.getElementById('rows');
    if (!list) return;
    var html = renderLoadOlder();
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
        html += renderRow(row);
      }
    }
    html += renderStreamTailRow();
    html += renderEmptyState();
    list.innerHTML = html;
  }
