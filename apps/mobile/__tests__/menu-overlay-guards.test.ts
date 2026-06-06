import {
  MENU_OPEN_GRACE_MS,
  shouldIgnoreMenuOutsideDismiss,
} from '../src/web/chat-transcript/menu-overlay-guards';

describe('menu-overlay-guards', () => {
  it('ignores bubble touchend during grace after long-press open', () => {
    const openedAt = 1000;
    expect(
      shouldIgnoreMenuOutsideDismiss('touchend', openedAt, openedAt + 50, true),
    ).toBe(true);
    expect(
      shouldIgnoreMenuOutsideDismiss('touchend', openedAt, openedAt + MENU_OPEN_GRACE_MS - 1, true),
    ).toBe(true);
  });

  it('allows dismiss after grace or on backdrop (non-row target)', () => {
    const openedAt = 1000;
    expect(
      shouldIgnoreMenuOutsideDismiss('touchend', openedAt, openedAt + MENU_OPEN_GRACE_MS, true),
    ).toBe(false);
    expect(
      shouldIgnoreMenuOutsideDismiss('touchend', openedAt, openedAt + 10, false),
    ).toBe(false);
    expect(
      shouldIgnoreMenuOutsideDismiss('click', openedAt, openedAt + 10, true),
    ).toBe(false);
  });
});
