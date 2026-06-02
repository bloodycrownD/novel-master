import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@novel-master/core', () => ({}));

import {prependOlderMessages} from '../src/services/message-paging';

describe('message-paging', () => {
  it('prepends older messages before current', () => {
    const older = [{id: '1', seq: 1}, {id: '2', seq: 2}] as any;
    const current = [{id: '3', seq: 3}] as any;
    expect(prependOlderMessages(current, older).map(m => m.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('returns current when older empty', () => {
    const current = [{id: '3', seq: 3}] as any;
    expect(prependOlderMessages(current, []).map(m => m.id)).toEqual(['3']);
  });
});

