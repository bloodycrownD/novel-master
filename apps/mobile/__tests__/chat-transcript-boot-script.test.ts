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

  it('renders stream tail with rich HTML when streamDelta.html is present', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('streamTextInner');
    expect(script).toContain('streamThinkingHtml');
    expect(script).toContain('updateStreamTextBubble');
    expect(script).toContain('p.html');
    expect(script).toContain("state.stream.textHtml = ''");
    expect(script).toContain("state.stream.thinkingHtml = ''");
  });
});
