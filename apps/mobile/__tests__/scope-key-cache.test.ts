/**
 * services/C-6 + b2/B-6：createScopeKeyCache 工厂本体单测。
 * - key 拼接与 get/set/clear/clearAll 基本语义
 * - LRU 有界（插入超限后 size 封顶、最旧淘汰、读取刷新新鲜度）
 * - clearByProjectPrefix 前缀清理不误删同前缀其它项目
 */
import {createScopeKeyCache} from '@/services/scope-key-cache';

describe('createScopeKeyCache', () => {
  it('builds scope keys as projectId:sessionId', () => {
    const cache = createScopeKeyCache<number>();
    expect(cache.key('p1', 's1')).toBe('p1:s1');
  });

  it('get/set/clear/clearAll round-trips values', () => {
    const cache = createScopeKeyCache<number>();
    cache.set('p1:s1', 1);
    expect(cache.get('p1:s1')).toBe(1);
    cache.clear('p1:s1');
    expect(cache.get('p1:s1')).toBeUndefined();
    cache.set('p1:s2', 2);
    cache.clearAll();
    expect(cache.size).toBe(0);
  });

  it('LRU 有界：插入超限后 size 封顶、最旧被淘汰、最新保留', () => {
    const cache = createScopeKeyCache<number>({maxEntries: 3});
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
    expect(cache.get('c')).toBe(3);
  });

  it('LRU：读取刷新新鲜度，被淘汰的是最久未使用条目', () => {
    const cache = createScopeKeyCache<number>({maxEntries: 2});
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // touch a，b 变为最旧
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('clearByProjectPrefix 只清该项目条目，同前缀相似项目不受影响', () => {
    const cache = createScopeKeyCache<number>();
    cache.set(cache.key('p1', 's1'), 1);
    cache.set(cache.key('p1', 's2'), 2);
    cache.set(cache.key('p10', 's1'), 3);
    cache.set(cache.key('p2', 's1'), 4);
    cache.clearByProjectPrefix('p1');
    expect(cache.size).toBe(2);
    expect(cache.get(cache.key('p10', 's1'))).toBe(3);
    expect(cache.get(cache.key('p2', 's1'))).toBe(4);
  });
});
