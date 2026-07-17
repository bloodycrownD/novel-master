import {
  NEAR_BOTTOM_THRESHOLD_PX,
  clampScrollTop,
  nearBottom,
  offsetFromBottom,
  scrollTopAfterPrepend,
  scrollTopForBottom,
  scrollTopForOffsetFromBottom,
} from '../src/webview-host/chat-transcript/scroll';

describe('chat-transcript scroll (forward DOM)', () => {
  it('computes offset from visual bottom', () => {
    expect(offsetFromBottom(100, 500, 300)).toBe(100);
    expect(offsetFromBottom(200, 500, 300)).toBe(0);
  });

  it('nearBottom within threshold', () => {
    expect(nearBottom(120, 500, 300, NEAR_BOTTOM_THRESHOLD_PX)).toBe(true);
    expect(nearBottom(0, 500, 300, NEAR_BOTTOM_THRESHOLD_PX)).toBe(false);
  });

  it('scrollTopForBottom pins to visual bottom', () => {
    expect(scrollTopForBottom(500, 300)).toBe(200);
  });

  it('scrollTopAfterPrepend preserves reading position', () => {
    expect(scrollTopAfterPrepend(50, 400, 600)).toBe(250);
  });

  it('scrollTopForOffsetFromBottom restores cached offset (T6)', () => {
    expect(scrollTopForOffsetFromBottom(500, 300, 100)).toBe(100);
    expect(scrollTopForOffsetFromBottom(500, 300, 0)).toBe(200);
  });

  it('clampScrollTop limits offset after tail shrink (rollback)', () => {
    expect(clampScrollTop(3000, 1500, 300)).toBe(1200);
    expect(clampScrollTop(500, 1500, 300)).toBe(500);
  });

  it('preserve after tail shrink restores offset-from-bottom (rollback)', () => {
    const prevOffsetFromBottom = offsetFromBottom(3000, 4500, 300);
    const nextScrollHeight = 1500;
    const restored = scrollTopForOffsetFromBottom(
      nextScrollHeight,
      300,
      prevOffsetFromBottom,
    );
    expect(restored).toBe(
      Math.max(0, nextScrollHeight - 300 - prevOffsetFromBottom),
    );
    expect(offsetFromBottom(restored, nextScrollHeight, 300)).toBe(
      prevOffsetFromBottom,
    );
  });
});
