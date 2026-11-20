import {SessionDefaultTitle} from '@/utils/session-default-title'

describe('nextDefaultSessionTitle', () => {
  it('returns 新会话1 when no numbered titles exist', () => {
    expect(SessionDefaultTitle.next([])).toBe('新会话1');
    expect(SessionDefaultTitle.next(['新会话', null, ''])).toBe('新会话1');
  });

  it('skips taken numbers', () => {
    expect(SessionDefaultTitle.next(['新会话1', '新会话3'])).toBe('新会话2');
    expect(SessionDefaultTitle.next(['新会话1', '新会话2'])).toBe('新会话3');
  });
});
