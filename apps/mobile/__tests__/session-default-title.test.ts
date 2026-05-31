import {nextDefaultSessionTitle} from '../src/utils/session-default-title';

describe('nextDefaultSessionTitle', () => {
  it('returns 新会话1 when no numbered titles exist', () => {
    expect(nextDefaultSessionTitle([])).toBe('新会话1');
    expect(nextDefaultSessionTitle(['新会话', null, ''])).toBe('新会话1');
  });

  it('skips taken numbers', () => {
    expect(nextDefaultSessionTitle(['新会话1', '新会话3'])).toBe('新会话2');
    expect(nextDefaultSessionTitle(['新会话1', '新会话2'])).toBe('新会话3');
  });
});
