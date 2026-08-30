/**
 * web/C-orch-3 + web/A-2：宿主 message 通道解析纯函数单测。
 * bindHostMessageChannel 的双注册按仓库惯例（Jest 为 RN 环境，无 jsdom）
 * 以源码契约断言补充。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  parseHostMessage,
  matchHostMessage,
} from '../src/web/shared/host-message-channel';

describe('shared/host-message-channel 纯函数', () => {
  it('parseHostMessage：JSON 字符串解析（chat 宽容口径）', () => {
    expect(
      parseHostMessage('{"v":1,"type":"init","payload":{"theme":{}}}'),
    ).toEqual({
      v: 1,
      type: 'init',
      payload: {theme: {}},
    });
  });

  it('parseHostMessage：对象型 raw 直通（宿主直接 postMessage 对象不丢消息）', () => {
    const raw = {v: 1, type: 'init', payload: {}};
    expect(parseHostMessage(raw)).toBe(raw);
  });

  it('parseHostMessage：坏 JSON / 非对象 / null 一律丢弃返回 null', () => {
    expect(parseHostMessage('not json')).toBeNull();
    expect(parseHostMessage('123')).toBeNull();
    expect(parseHostMessage('null')).toBeNull();
    expect(parseHostMessage(null)).toBeNull();
    expect(parseHostMessage(undefined)).toBeNull();
  });

  it('matchHostMessage：v 不匹配被丢弃（字符串与对象两形态）', () => {
    expect(
      matchHostMessage(JSON.stringify({v: 2, type: 'init'}), 1),
    ).toBeNull();
    expect(matchHostMessage({v: 2, type: 'init'}, 1)).toBeNull();
    expect(matchHostMessage({v: undefined, type: 'init'}, 1)).toBeNull();
  });

  it('matchHostMessage：type 缺失被丢弃（web/A-2 对齐另两域）', () => {
    expect(matchHostMessage({v: 1}, 1)).toBeNull();
    expect(matchHostMessage({v: 1, type: ''}, 1)).toBeNull();
    expect(matchHostMessage(JSON.stringify({v: 1, payload: {}}), 1)).toBeNull();
  });

  it('matchHostMessage：合法 envelope 直通（v/type/payload 齐全）', () => {
    const msg = {v: 1, type: 'init', payload: {theme: {}}};
    expect(matchHostMessage(msg, 1)).toEqual(msg);
    expect(matchHostMessage(JSON.stringify(msg), 1)).toEqual(msg);
  });
});

describe('shared/host-message-channel 源码契约（双注册）', () => {
  it('bindHostMessageChannel 统一 document + window 双注册', () => {
    const src = readFileSync(
      join(__dirname, '../src/web/shared/host-message-channel.ts'),
      'utf8',
    );
    expect(src).toContain("document.addEventListener('message'");
    expect(src).toContain("window.addEventListener('message'");
  });
});
