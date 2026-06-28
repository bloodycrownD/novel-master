import {buildTranscriptBootScript} from '../src/web/chat-transcript/main';
import {MENU_OPEN_GRACE_MS} from '../src/web/chat-transcript/menu-overlay-guards';

describe('chat-transcript boot script', () => {
  it('dismisses context menu via document capture (outside #rows)', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('menuOverlayHandler');
    expect(script).toContain('handleMenuOverlayEvent');
    expect(script).toContain("document.addEventListener('click', state.menuOverlayHandler, true)");
    expect(script).toContain('Backdrop lives on document.body outside #rows');
    expect(script).toContain(`MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS}`);
    expect(script).toContain('state.menuOpenedAt');
    expect(script).toContain('layoutContextMenu');
    expect(script).toContain('scrollable');
    expect(script).toContain('resolveMenuAnchor');
    expect(script).toContain('touch.clientX');
    expect(script).toContain('querySelector(\'.bubble\')');
    expect(script).toContain('Long-press finger point');
    expect(script).toContain('menu.items.length <= 6');
    expect(script).toContain('measuredHeight');
    expect(script).toContain('onMessagePointerMove');
    expect(script).toContain('shouldCancelLongPressForMove');
    expect(script).toContain('decodeLiteralHtmlEntities');
    expect(script).toContain('richToggledOn');
    expect(script).toContain('attachMenuNativeTextBlock');
    expect(script).toContain('menu-open');
    expect(script).toContain('touchH');
  });

  it('widens thinking/tools-only assistant bubbles', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('bubble--fill-width');
    expect(script).toContain('hasThinking');
    expect(script).toContain('hasTools');
  });

  it('pre-seeds empty bubble body for thinking/tool-invoking only stream bubbles', () => {
    const script = buildTranscriptBootScript();
    // 守护 spec：当仅有 thinking/toolInvoking、正文为空时，也要预置 .bubble-body，避免后续 text 增量时退回整泡重建。
    expect(script).toContain('} else if (hasThinking || hasInvoking) {');
    expect(script).toContain("var richShellBubble = state.flags.richText && textHtml ? ' rich' : '';");
    expect(script).toContain("html += '<div class=\"bubble-body' + richShellBubble + '\" data-text-shell=\"1\"></div>';");
    expect(script).toContain("var hasInvoking = !!showToolInvoking;");
  });

  it('renders stream tail with rich HTML when streamDelta.html is present', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('renderStreamBubbleInner');
    expect(script).toContain('renderAssistantBubbleInner');
    expect(script).toContain('ensureStreamTextBody');
    expect(script).toContain('data-text-shell');
    expect(script).toContain('setStreamToolInvokingDom');
    expect(script).toContain('streamThinkingHtml');
    expect(script).toContain('updateStreamBubble');
    expect(script).toContain('p.html');
    expect(script).toContain("state.stream.textHtml = ''");
    expect(script).toContain("state.stream.thinkingHtml = ''");
  });

  it('updates stream tail incrementally when streamDelta.html is present', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('body.innerHTML = html');
    expect(script).toContain('renderStreamingMarkdown');
    expect(script).toContain('scheduleStreamRichUpgrade');
    expect(script).toContain('appendStreamDeltaIncremental');
    expect(script).toContain('applyStreamBatch');
    expect(script).toContain("case 'streamBatch'");
  });

  it('does not rebuild whole bubble when text incremental update fails', () => {
    const script = buildTranscriptBootScript();
    // 守护 spec：text 路径 incremental===false 时不能调用 updateStreamBubble，防回归到“text 首包失败整泡重建”旧逻辑。
    expect(script).toContain("if (!incremental && kind !== 'text') {");
    expect(script).toContain('updateStreamBubble(tail);');
    // 守护 spec：仅在 stream tail 不存在时，允许 fallback 到 renderRows。
    expect(script).toContain('if (!tail) {');
    expect(script).toContain('renderRows();');
  });

  it('appends text delta when richText=true and html is missing', () => {
    const script = buildTranscriptBootScript();
    // 守护 spec：text 在 rich+noHtml 场景必须直接 insertAdjacentHTML，不受 streamRichDomReady 门槛影响。
    expect(script).toContain("if (state.flags.richText && !html) {");
    expect(script).toContain("} else if (kind === 'text') {");
    expect(script).toContain("var streamTextBody = ensureStreamTextBody(bubble);");
    expect(script).toContain("streamTextBody.insertAdjacentHTML('beforeend', escapeHtml(delta));");
  });

  it('normalizes relative vfs tool paths in boot script', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('resolveVfsToolFilePath');
    expect(script).toContain('resolveLogicalPathForToolCard');
    expect(script).toContain("return normalizePathForToolCard('/' + trimmed);");
  });
});
