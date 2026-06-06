import {
  NEAR_BOTTOM_THRESHOLD_PX,
  nearBottom,
  offsetFromBottom,
  scrollTopAfterPrepend,
  scrollTopForBottom,
} from '../src/web/chat-transcript/scroll';

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
});
