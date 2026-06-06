import {buildRichDocumentBootScript} from '../src/web/rich-document/main';

describe('rich-document boot script', () => {
  it('handles setDocument and has no menu handlers', () => {
    const script = buildRichDocumentBootScript();
    expect(script).toContain('setDocument');
    expect(script).toContain("msg.type === 'setDocument'");
    expect(script).toContain('handleHostMessage');
    expect(script).toContain('themeUpdate');
    expect(script).not.toContain('menuOverlayHandler');
    expect(script).not.toContain('openMessageMenu');
  });

  it('shows over-limit hint in plain fallback mode', () => {
    const script = buildRichDocumentBootScript();
    expect(script).toContain('over-limit-hint');
    expect(script).toContain('内容过长，已显示原文');
  });
});
