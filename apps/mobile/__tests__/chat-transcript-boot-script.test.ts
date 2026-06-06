import {buildTranscriptBootScript} from '../src/web/chat-transcript/main';

describe('chat-transcript boot script', () => {
  it('dismisses context menu via document capture (outside #rows)', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('menuOverlayHandler');
    expect(script).toContain('handleMenuOverlayEvent');
    expect(script).toContain("document.addEventListener('click', state.menuOverlayHandler, true)");
    expect(script).toContain('Backdrop lives on document.body outside #rows');
  });

  it('renders stream tail with rich HTML when streamDelta.html is present', () => {
    const script = buildTranscriptBootScript();
    expect(script).toContain('streamTextInner');
    expect(script).toContain('streamThinkingHtml');
    expect(script).toContain('updateStreamTextBubble');
    expect(script).toContain('p.html');
  });
});
