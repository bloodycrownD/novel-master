/**
 * stream-checkpoint 纯函数表（spec §2.3.5 / C20 / T-SP7 的 merge 象限）。
 *
 * 判定表与 mergeCheckpoint 四象限逐格钉死：故意改坏 decideStreamDelta /
 * mergeCheckpoint 时本套件必须变红。
 */
import {
  decideStreamDelta,
  mergeCheckpoint,
  type StreamCheckpoint,
} from '../src/web/chat-transcript/webview/runtime/stream/stream-checkpoint';

const cp = (
  id: string,
  seq: number,
  status: 'streaming' | 'finished' = 'streaming',
): StreamCheckpoint => ({id, seq, status});

describe('decideStreamDelta（delta 应用判定表）', () => {
  const cases: Array<{
    name: string;
    local: StreamCheckpoint | null;
    streamId: string;
    seq: number;
    expected: 'apply' | 'ignore' | 'resync';
  }> = [
    {
      name: '无检查点 → resync（还没有基线）',
      local: null,
      streamId: 'st:a',
      seq: 1,
      expected: 'resync',
    },
    {
      name: '跨流（id 不同）→ resync',
      local: cp('st:a', 5),
      streamId: 'st:b',
      seq: 1,
      expected: 'resync',
    },
    {
      name: '已 finished → ignore',
      local: cp('st:a', 5, 'finished'),
      streamId: 'st:a',
      seq: 6,
      expected: 'ignore',
    },
    {
      name: 'seq <= applied（重复）→ ignore',
      local: cp('st:a', 5),
      streamId: 'st:a',
      seq: 5,
      expected: 'ignore',
    },
    {
      name: 'seq < applied（过期）→ ignore',
      local: cp('st:a', 5),
      streamId: 'st:a',
      seq: 3,
      expected: 'ignore',
    },
    {
      name: 'seq === applied + 1 → apply',
      local: cp('st:a', 5),
      streamId: 'st:a',
      seq: 6,
      expected: 'apply',
    },
    {
      name: 'seq > applied + 1（gap）→ resync',
      local: cp('st:a', 5),
      streamId: 'st:a',
      seq: 7,
      expected: 'resync',
    },
    {
      name: 'seq 0 从 0 起（空流首包）→ apply',
      local: cp('st:a', 0),
      streamId: 'st:a',
      seq: 1,
      expected: 'apply',
    },
  ];

  for (const item of cases) {
    it(item.name, () => {
      expect(decideStreamDelta(item.local, item.streamId, item.seq)).toBe(
        item.expected,
      );
    });
  }
});

describe('mergeCheckpoint（四象限）', () => {
  it('incoming == null → null（快照声明没有流式行）', () => {
    expect(mergeCheckpoint(cp('st:a', 5), null)).toBeNull();
    expect(mergeCheckpoint(null, null)).toBeNull();
  });

  it('local == null → incoming（原样）', () => {
    const incoming = cp('st:a', 3);
    expect(mergeCheckpoint(null, incoming)).toBe(incoming);
  });

  it('异 id → incoming（新流换主，不取 max）', () => {
    const incoming = cp('st:b', 1);
    expect(mergeCheckpoint(cp('st:a', 9), incoming)).toBe(incoming);
  });

  it('同 id → seq 取 max，status 收尾不可逆', () => {
    expect(mergeCheckpoint(cp('st:a', 5), cp('st:a', 7))).toEqual({
      id: 'st:a',
      seq: 7,
      status: 'streaming',
    });
    expect(mergeCheckpoint(cp('st:a', 7), cp('st:a', 5))).toEqual({
      id: 'st:a',
      seq: 7,
      status: 'streaming',
    });
    // local finished 不被 incoming streaming 翻回
    expect(mergeCheckpoint(cp('st:a', 5, 'finished'), cp('st:a', 7))).toEqual({
      id: 'st:a',
      seq: 7,
      status: 'finished',
    });
    // incoming finished 覆盖 local streaming
    expect(mergeCheckpoint(cp('st:a', 5), cp('st:a', 6, 'finished'))).toEqual({
      id: 'st:a',
      seq: 6,
      status: 'finished',
    });
  });
});
