import {describe, expect, it} from '@jest/globals';
import {composerDockBottomPadding} from '../src/components/chat/composer-dock-padding';

describe('composerDockBottomPadding', () => {
  it('T-N4: safe-area bottom 大于 base 时取 insets', () => {
    expect(composerDockBottomPadding(34)).toBe(34);
    expect(composerDockBottomPadding(34, 8)).toBe(34);
  });

  it('T-N4: insets 为 0 时仍保留 base padding', () => {
    expect(composerDockBottomPadding(0)).toBe(8);
    expect(composerDockBottomPadding(4, 8)).toBe(8);
  });
});
