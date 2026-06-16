/**
 * Lightweight streaming markdown for WebView tail (no markdown-it).
 * Persisted rows still use RN prepareTranscriptRichHtml + sanitize.
 *
 * Hot path: append escaped plain deltas immediately.
 * Debounced upgrade: full renderStreamingMarkdown after idle (cheap during fast token burst).
 */
export const STREAM_MARKDOWN_BOOT = `
  var STREAM_RICH_UPGRADE_MS = 350;
  var streamRichUpgrade = {
    timer: null,
    kinds: { text: false, thinking: false },
    plainMode: { text: true, thinking: true }
  };

  function renderStreamingInline(s) {
    var escaped = escapeHtmlRaw(s);
    return escaped
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  }

  function renderStreamingMarkdown(text) {
    var normalized = decodeLiteralHtmlEntities(String(text || '').trim());
    if (!normalized) return '';
    var lines = normalized.split(/\\n/);
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = /^\\s*[-*+]\\s+(.+)$/.exec(line);
      var ordered = /^\\s*\\d+\\.\\s+(.+)$/.exec(line);
      if (bullet) {
        if (!inList) { html += '<ul>'; inList = 'ul'; }
        else if (inList === 'ol') { html += '</ol><ul>'; inList = 'ul'; }
        html += '<li>' + renderStreamingInline(bullet[1]) + '</li>';
        continue;
      }
      if (ordered) {
        if (!inList) { html += '<ol>'; inList = 'ol'; }
        else if (inList === 'ul') { html += '</ul><ol>'; inList = 'ol'; }
        html += '<li>' + renderStreamingInline(ordered[1]) + '</li>';
        continue;
      }
      if (inList) {
        html += inList === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      if (line.trim() === '') continue;
      html += '<p>' + renderStreamingInline(line) + '</p>';
    }
    if (inList) html += inList === 'ul' ? '</ul>' : '</ol>';
    return html;
  }

  function clearStreamRichUpgrade() {
    if (streamRichUpgrade.timer != null) {
      clearTimeout(streamRichUpgrade.timer);
      streamRichUpgrade.timer = null;
    }
    streamRichUpgrade.kinds.text = false;
    streamRichUpgrade.kinds.thinking = false;
    streamRichUpgrade.plainMode.text = true;
    streamRichUpgrade.plainMode.thinking = true;
  }

  function paintStreamRichKind(tail, kind) {
    var bubble = tail.querySelector('.bubble');
    if (!bubble) return;
    if (kind === 'thinking') {
      var section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
      var body = section ? section.querySelector('.thinking-body') : null;
      if (!body) return;
      var thinkingHtml = renderStreamingMarkdown(state.stream.thinking);
      if (!thinkingHtml) return;
      body.innerHTML = thinkingHtml;
      setStreamBodyRichClass(body, true);
      state.stream.thinkingHtml = thinkingHtml;
    } else {
      var textBody = ensureStreamTextBody(bubble);
      var textHtml = renderStreamingMarkdown(state.stream.text);
      if (!textHtml) return;
      textBody.innerHTML = textHtml;
      setStreamBodyRichClass(textBody, true);
      state.stream.textHtml = textHtml;
    }
    bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
      undefined
    );
  }

  function flushStreamRichUpgrade() {
    streamRichUpgrade.timer = null;
    var tail = document.getElementById('stream-tail');
    if (!tail) return;
    var paintStart = Date.now();
    if (streamRichUpgrade.kinds.text) {
      paintStreamRichKind(tail, 'text');
      streamRichUpgrade.kinds.text = false;
      streamRichUpgrade.plainMode.text = false;
    }
    if (streamRichUpgrade.kinds.thinking) {
      paintStreamRichKind(tail, 'thinking');
      streamRichUpgrade.kinds.thinking = false;
      streamRichUpgrade.plainMode.thinking = false;
    }
    void paintStart;
    scheduleStickIfNearBottom();
  }

  function scheduleStreamRichUpgrade(kind) {
    if (!state.flags.richText) return;
    streamRichUpgrade.kinds[kind] = true;
    if (streamRichUpgrade.timer != null) return;
    streamRichUpgrade.timer = setTimeout(flushStreamRichUpgrade, STREAM_RICH_UPGRADE_MS);
  }
`;
