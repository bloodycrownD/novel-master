/**
 * storage-config-migration-values 纯函数单测（ic-22）：迁移状态行四组
 * 夹具直测，替代源码正则拼字面量——任一渲染分支写错（如 null 分支返回
 * 「进行中」）对应夹具即红。
 *
 * 四组夹具（两端渲染值函数的全集口径）：
 * 未取到 → '—'；done → 已完成；!done → 进行中（剩余 N 条）；
 * done && failedCount > 0 → 已完成（N 条需人工处理）。
 * 第三组「需人工处理」只在 blobBinaryValue 上成立（cr-06：core
 * BlobBinaryTableStatus 携带 failedCount；MessageDecompressStatus 无此
 * 字段，迁移期坏行不改变状态行的两态形态）。
 *
 * vfsPackValue（T-VP22 第四行）：打包无终态、无 done 字段，收敛判定取
 * pendingGroups === 0——夹具口径为：null → '—'；pendingGroups > 0 →
 * 剩余 N 组；pendingGroups === 0 && failedGroups === 0 → 无需处理；
 * pendingGroups === 0 && failedGroups > 0 → 已完成（N 组需人工处理）。
 */
import {
  blobBinaryValue,
  messageDecompressValue,
  vfsPackValue,
} from '@/screens/stack/storage-config-migration-values';

describe('messageDecompressValue 夹具', () => {
  it('null（未取到）→ 占位 ‘—’，默认色', () => {
    expect(messageDecompressValue(null)).toEqual({
      value: '—',
      tone: 'default',
    });
  });

  it('done → 已完成，success 色', () => {
    expect(
      messageDecompressValue({done: true, pendingCount: 0}),
    ).toEqual({value: '已完成', tone: 'success'});
  });

  it('!done → 进行中（剩余 N 条），默认色', () => {
    expect(
      messageDecompressValue({done: false, pendingCount: 7}),
    ).toEqual({value: '进行中（剩余 7 条）', tone: 'default'});
  });
});

describe('blobBinaryValue 夹具（cr-06 三态）', () => {
  it('undefined（表未注册/未取到）→ 占位 ‘—’，默认色', () => {
    expect(blobBinaryValue(undefined)).toEqual({
      value: '—',
      tone: 'default',
    });
  });

  it('done 且无失败行 → 已完成，success 色', () => {
    expect(
      blobBinaryValue({table: 'vfsContent', done: true, pendingCount: 0, failedCount: 0}),
    ).toEqual({value: '已完成', tone: 'success'});
  });

  it('!done → 进行中（剩余 N 条），默认色', () => {
    expect(
      blobBinaryValue({table: 'vfsContent', done: false, pendingCount: 3, failedCount: 0}),
    ).toEqual({value: '进行中（剩余 3 条）', tone: 'default'});
  });

  it('done && failedCount > 0 → 已完成（N 条需人工处理），warning 色', () => {
    expect(
      blobBinaryValue({table: 'fileCache', done: true, pendingCount: 0, failedCount: 2}),
    ).toEqual({
      value: '已完成（2 条需人工处理）',
      tone: 'warning',
    });
  });
});

describe('vfsPackValue 夹具（T-VP22 第四行，无终态两态 + 坏组第三态）', () => {
  it('null（未取到/采样失败）→ 占位 ‘—’，默认色', () => {
    expect(vfsPackValue(null)).toEqual({value: '—', tone: 'default'});
  });

  it('pendingGroups > 0 → 剩余 N 组，默认色（进行中态）', () => {
    expect(
      vfsPackValue({pendingGroups: 6, memberCount: 120, streamBytes: 1_600_000, failedGroups: 0}),
    ).toEqual({value: '剩余 6 组', tone: 'default'});
  });

  it('收敛且无坏组 → 无需处理，success 色', () => {
    expect(
      vfsPackValue({pendingGroups: 0, memberCount: 120, streamBytes: 1_600_000, failedGroups: 0}),
    ).toEqual({value: '无需处理', tone: 'success'});
  });

  it('收敛但 failedGroups > 0 → 已完成（N 组需人工处理），warning 色（第三态）', () => {
    expect(
      vfsPackValue({pendingGroups: 0, memberCount: 120, streamBytes: 1_600_000, failedGroups: 2}),
    ).toEqual({
      value: '已完成（2 组需人工处理）',
      tone: 'warning',
    });
  });

  it('pendingGroups > 0 时坏组快照不抢进行中态（进度优先显示）', () => {
    expect(
      vfsPackValue({pendingGroups: 3, memberCount: 120, streamBytes: 1_600_000, failedGroups: 2}),
    ).toEqual({value: '剩余 3 组', tone: 'default'});
  });
});
