/**
 * storage-config-migration-values 纯函数单测（ic-22）：迁移状态行四组
 * 夹具直测，替代源码正则拼字面量——任一渲染分支写错（如 null 分支返回
 * 「进行中」）对应夹具即红。
 *
 * 四组夹具（两端渲染值函数的全集口径）：
 * 未取到 → '—'；done → 已完成；!done → 进行中（剩余 N 条）；
 * done && failedCount > 0 → 已完成（N 条需人工处理）。
 * 第三组「需人工处理」只在 blobBinaryValue 上成立（cr-06：core
 * BlobBinaryTableStatus 携带 failedCount；MessageCompactionStatus 无此
 * 字段，压缩行无第三态）。
 */
import {
  blobBinaryValue,
  messageCompactionValue,
} from '@/screens/stack/storage-config-migration-values';

describe('messageCompactionValue 夹具', () => {
  it('null（未取到）→ 占位 ‘—’，默认色', () => {
    expect(messageCompactionValue(null)).toEqual({
      value: '—',
      tone: 'default',
    });
  });

  it('done → 已完成，success 色', () => {
    expect(
      messageCompactionValue({done: true, pendingCount: 0}),
    ).toEqual({value: '已完成', tone: 'success'});
  });

  it('!done → 进行中（剩余 N 条），默认色', () => {
    expect(
      messageCompactionValue({done: false, pendingCount: 7}),
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
